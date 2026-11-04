import * as ort from "onnxruntime-web/webgpu"
// JSEP 构建（onnxruntime-web/webgpu）：唯一支持 WebGPU EP 的变体；wasm 回退也在其中
import { extUrl } from "../env"
import { decodeOutput, scaleBoxes, behaviorFor, MODEL_CLASSES, type RawBox } from "./decode"
import { letterbox } from "./preprocess"

export const DEFAULT_MODEL_URL =
  "https://huggingface.co/wybxc/DocLayout-YOLO-DocStructBench-onnx/resolve/main/doclayout_yolo_docstructbench_imgsz1024.onnx"
const MODEL_CACHE_KEY = "doclayout_yolo_docstructbench_imgsz1024.onnx"
const INPUT_SIZE = 1024
const STRIDE = 32
const CONF_THRESHOLD = 0.25
/** 单页推理超时：webgpu 偶发挂起的兜底阈值（正常单页推理远小于 1s） */
const PREDICT_TIMEOUT_MS = 60_000

// ORT 的 wasm 资源在打包后无法按默认相对路径定位（Task 9 实测：动态 import 胶水 .mjs 回退到
// 文档 URL → 404/HTML MIME 错 → session 创建挂死），统一显式指到资源根目录：
// - 扩展页面上下文：chrome.runtime.getURL("/")（public/ 下的 ort-wasm-*.{wasm,mjs}）
// - 普通 http 页面（本地验收服务器）：站点根目录（同样由 public/ 提供）
// 多线程 pthread 在 JSEP 构建下实测会令 session.create 永久挂起（wasmPaths 下 .mjs worker
// 派生不可靠），固定单线程。加速改走 WebGPU EP（JSEP 已启用），而非多线程。
ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = extUrl("/")

export interface Region {
  x1: number
  y1: number
  x2: number
  y2: number
  className: string
  conf: number
  behavior: "translate" | "keep" | "skip"
}

/** 入口提供执行后端要求；默认保留产品的 WebGPU 优先行为。 */
export interface LayoutModelOptions {
  forceWasm?: boolean
}

export class LayoutModelRunner {
  private session!: ort.InferenceSession
  /** 模型原始字节：webgpu 挂起后重建 wasm 会话用 */
  private modelBuf!: ArrayBuffer
  private inputName = "images"
  private dimsLogged = false
  names: string[] = []
  backend = "wasm"
  loadMs = 0

  static async load(
    modelUrl?: string,
    onProgress?: (loadedBytes: number, totalBytes: number | null) => void,
    loadOptions: LayoutModelOptions = {},
  ): Promise<LayoutModelRunner> {
    const t0 = performance.now()
    const url = modelUrl ?? resolveDefaultModelUrl()
    const runner = new LayoutModelRunner()
    ;(globalThis as any).__modelStage = "fetching"
    console.info("[model] fetch model…")
    const buf = await fetchModelCached(url, onProgress)
    runner.modelBuf = buf
    ;(globalThis as any).__modelStage = "creating:" + runner.backend
    console.info(
      `[model] fetched ${(buf.byteLength / 1e6).toFixed(1)}MB in ${Math.round(performance.now() - t0)}ms, creating session (webgpu→wasm)…`,
    )
    // 注意：ORT 对不可用的 EP 只告警不抛错（实测），把 webgpu/wasm 分开探测才能拿到真实 backend
    const options: ort.InferenceSession.SessionOptions = { graphOptimizationLevel: "all" }
    try {
      if (loadOptions.forceWasm) throw new Error("入口要求使用 wasm")
      runner.session = await ort.InferenceSession.create(new Uint8Array(buf), {
        ...options,
        executionProviders: ["webgpu"],
      })
      runner.backend = "webgpu"
    } catch (e) {
      console.info(
        `[model] webgpu EP 不可用（${e instanceof Error ? e.message.slice(0, 80) : String(e)}），回退 wasm…`,
      )
      runner.session = await ort.InferenceSession.create(new Uint8Array(buf), {
        ...options,
        executionProviders: ["wasm"],
      })
      runner.backend = "wasm"
    }
    console.info(
      `[model] session created (${runner.backend}), ${Math.round(performance.now() - t0)}ms`,
    )
    // 类别名从 ONNX metadata 自动发现（session.metadata 需 ORT ≥1.21；1.20.1 无此 API，走兜底）
    const metaNames = (
      runner.session as { metadata?: { metadata_key: string; metadata_value: string }[] }
    ).metadata?.find((m) => m.metadata_key === "names")?.metadata_value
    if (metaNames) {
      try {
        runner.names = Object.values(JSON.parse(metaNames.replace(/'/g, '"')))
      } catch {
        /* 兜底：MODEL_CLASSES */
      }
    }
    if (runner.names.length === 0) runner.names = [...MODEL_CLASSES]
    runner.inputName = runner.session.inputNames[0] ?? "images"
    ;(globalThis as any).__modelStage = "done"
    runner.loadMs = performance.now() - t0
    return runner
  }

  get sessionInputName() {
    return this.inputName
  }

  /** 推理超时兜底：webgpu 偶发挂起时 run 既不返回也不抛错，只能靠外层计时 */
  private async runWithTimeout(
    feeds: Record<string, ort.Tensor>,
    timeoutMs: number,
  ): Promise<Awaited<ReturnType<ort.InferenceSession["run"]>>> {
    return await Promise.race([
      this.session.run(feeds),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`session.run 超过 ${timeoutMs / 1000}s 无响应`)),
          timeoutMs,
        ),
      ),
    ])
  }

  /** 用缓存下来的模型字节重建会话（webgpu 挂起后降级 wasm 用） */
  private async recreateSession(executionProviders: string[]): Promise<void> {
    const options: ort.InferenceSession.SessionOptions = { graphOptimizationLevel: "all" }
    this.session = await ort.InferenceSession.create(new Uint8Array(this.modelBuf), {
      ...options,
      executionProviders,
    })
    this.backend = executionProviders[0] ?? this.backend
    this.inputName = this.session.inputNames[0] ?? this.inputName
  }

  /** 整页 canvas → 输入张量 → 区域（源图 CSS px 坐标） */
  async predictPage(canvas: HTMLCanvasElement, cssW: number, cssH: number): Promise<Region[]> {
    const lb = letterbox(cssW, cssH, INPUT_SIZE, STRIDE)
    const input = buildPageInput(canvas, cssW, cssH, lb)
    return this.predictTensor(input, cssW, cssH)
  }

  /** 已构建好的 [1,3,1024,1024] RGB/255 张量 → 区域（源图 CSS px 坐标）。独立暴露以便无 canvas 环境集成验证 */
  async predictTensor(input: Float32Array, cssW: number, cssH: number): Promise<Region[]> {
    const lb = letterbox(cssW, cssH, INPUT_SIZE, STRIDE)
    const feeds: Record<string, ort.Tensor> = {
      [this.inputName]: new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    }
    let results: Awaited<ReturnType<ort.InferenceSession["run"]>>
    try {
      results = await this.runWithTimeout(feeds, PREDICT_TIMEOUT_MS)
    } catch {
      // webgpu 偶发挂起（run 既不返回也不抛错，2026-09-18 实机复现）：重建 wasm 会话重试一次
      console.info("[model] 推理无响应，重建 wasm 会话重试…")
      await this.recreateSession(["wasm"])
      results = await this.runWithTimeout(feeds, PREDICT_TIMEOUT_MS)
    }
    const out = results[this.session.outputNames[0]!]!
    if (!this.dimsLogged) {
      this.dimsLogged = true
      // 实测（wybxc/DocLayout-YOLO-DocStructBench）：[1, 300, 6] 行主序端到端输出
      console.debug("[LayoutModelRunner] output dims:", out.dims)
    }
    const raw: RawBox[] = decodeOutput(
      out.data as Float32Array,
      out.dims,
      this.names,
      CONF_THRESHOLD,
    )
    const scaled = scaleBoxes(raw, lb, cssW, cssH)
    return scaled.map((b) => ({
      x1: b.x1,
      y1: b.y1,
      x2: b.x2,
      y2: b.y2,
      className: this.names[b.classId] ?? `class${b.classId}`,
      conf: b.conf,
      behavior: behaviorFor(this.names[b.classId] ?? ""),
    }))
  }
}

/** canvas → [1,3,1024,1024] RGB/255 张量，补边灰 114。
 *  关键：按精确 lb.scale 绘制 round(cssW*scale) × round(cssH*scale)，锚定 (padX/2, padY/2)；
 *  resizedW/H 只是 stride 对齐的信息值，绝不能按它拉伸（否则有效 scale 与 scaleBoxes 除数不一致）。 */
function buildPageInput(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  lb: ReturnType<typeof letterbox>,
): Float32Array {
  const tmp = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE)
  const tctx = tmp.getContext("2d")!
  tctx.fillStyle = "rgb(114,114,114)"
  tctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
  tctx.drawImage(
    canvas,
    Math.round(lb.padX / 2),
    Math.round(lb.padY / 2),
    Math.round(cssW * lb.scale),
    Math.round(cssH * lb.scale),
  )
  const data = tctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data
  const input = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE)
  const plane = INPUT_SIZE * INPUT_SIZE
  for (let p = 0; p < plane; p++) {
    input[p] = data[p * 4]! / 255
    input[plane + p] = data[p * 4 + 1]! / 255
    input[2 * plane + p] = data[p * 4 + 2]! / 255
  }
  return input
}

type ModelProgressCallback = (loadedBytes: number, totalBytes: number | null) => void

/** 流式读取响应体并按 1s 节流上报进度（用户要求：已加载 xxMB/共 xxMB 一秒刷新一次）。
 *  无 body（如测试环境）或未传回调时退回 arrayBuffer()。 */
async function readWithProgress(
  resp: Response,
  onProgress?: ModelProgressCallback,
): Promise<ArrayBuffer> {
  if (!resp.body || !onProgress) return resp.arrayBuffer()
  const totalHeader = resp.headers.get("content-length")
  const total = totalHeader ? Number(totalHeader) : null
  const reader = resp.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  let lastReport = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    const now = Date.now()
    if (now - lastReport >= 1000) {
      lastReport = now
      onProgress(loaded, total)
    }
  }
  onProgress(loaded, total ?? loaded)
  const out = new Uint8Array(loaded)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out.buffer
}

async function fetchModelCached(
  url: string,
  onProgress?: ModelProgressCallback,
): Promise<ArrayBuffer> {
  // 内置/指定模型必须读取其实际字节；不能命中默认远程模型的旧缓存，
  // 加载失败也不能换用另一个模型，否则验证切片的模型指纹会失真。
  if (url !== DEFAULT_MODEL_URL && url !== MIRROR_FALLBACK) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`model download failed: ${response.status}`)
    return readWithProgress(response, onProgress)
  }
  if (typeof caches !== "undefined") {
    const cache = await caches.open("layout-model")
    // 以固定 https 键存取（含 MODEL_CACHE_KEY 语义：默认远程模型与其镜像共享同一份缓存）。
    // 不能用裸文件名/chrome-extension 路径当键——扩展页 scheme 下 Cache API 会抛
    // "Request scheme 'chrome-extension' is unsupported"。
    const cacheKey = `https://layout-model-cache.local/${MODEL_CACHE_KEY}`
    const hit = await cache.match(cacheKey)
    if (hit) return readWithProgress(hit, onProgress)
    const resp = await fetchWithMirrorFallback(url)
    if (!resp.ok) throw new Error(`model download failed: ${resp.status}`)
    // 先流式读完（进度 1s 节流回调），再把完整缓冲写入缓存。
    // 不能 await cache.put(key, resp.clone()) 后再读 resp——clone() 是 tee 语义，
    // put 会把克隆分支读到完成才 resolve，主分支瞬间倾泻，进度回调全部堆在最后。
    const buf = await readWithProgress(resp, onProgress)
    await cache.put(cacheKey, new Response(buf, { headers: resp.headers }))
    return buf
  }
  const resp = await fetchWithMirrorFallback(url)
  if (!resp.ok) throw new Error(`model download failed: ${resp.status}`)
  return readWithProgress(resp, onProgress)
}

/** hf.co 直连在部分网络不可达：主 URL 失败/超时后走 hf-mirror */
const MIRROR_FALLBACK =
  "https://hf-mirror.com/wybxc/DocLayout-YOLO-DocStructBench-onnx/resolve/main/doclayout_yolo_docstructbench_imgsz1024.onnx"

async function fetchWithMirrorFallback(url: string): Promise<Response> {
  if (url === MIRROR_FALLBACK) return fetch(url)
  try {
    const resp = await withTimeout(fetch(url), 15_000)
    if (resp.ok) return resp
  } catch {
    /* 落到镜像 */
  }
  return fetch(MIRROR_FALLBACK)
}

function withTimeout(p: Promise<Response>, ms: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("model fetch timeout")), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/** 默认模型 URL 解析：
 * 构建时 vite.define 会把 (import.meta.env as any).WXT_BUNDLE_MODEL 替换成 true/false 字面量。
 * 内置模型由共用资源地址读取；未启用时走远程下载与缓存。 */
function resolveDefaultModelUrl(): string {
  if ((import.meta.env as any).WXT_BUNDLE_MODEL) return extUrl("doclayout_yolo.onnx")
  return DEFAULT_MODEL_URL
}
