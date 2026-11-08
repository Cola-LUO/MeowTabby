import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  create:
    vi.fn<
      (
        data: Uint8Array,
        options: { executionProviders: string[] },
      ) => Promise<{ inputNames: string[] }>
    >(),
  fetch: vi.fn<typeof fetch>(),
}))
vi.mock("onnxruntime-web/webgpu", () => ({
  env: { wasm: {} },
  InferenceSession: { create: mocks.create },
}))
vi.mock("../env", () => ({ extUrl: (p: string) => `https://assets.example/${p}` }))

import { DEFAULT_MODEL_URL, LayoutModelRunner } from "../layout/model-runner"

describe("共用模型执行选项", () => {
  beforeEach(() => {
    mocks.create.mockReset().mockResolvedValue({ inputNames: ["images"] })
    mocks.fetch.mockReset().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))
    vi.stubGlobal("fetch", mocks.fetch)
    vi.stubGlobal("caches", undefined)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("验证器可强制WASM，跳过WebGPU探测", async () => {
    const runner = await LayoutModelRunner.load("https://model.example/local.onnx", undefined, {
      forceWasm: true,
    })
    expect(runner.backend).toBe("wasm")
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0]![1]).toMatchObject({ executionProviders: ["wasm"] })
  })

  it("产品默认仍优先WebGPU，并保持下载进度回调", async () => {
    const progress = vi.fn<(loadedBytes: number, totalBytes: number | null) => void>()
    const runner = await LayoutModelRunner.load("https://model.example/local.onnx", progress)
    expect(runner.backend).toBe("webgpu")
    expect(mocks.create.mock.calls[0]![1]).toMatchObject({ executionProviders: ["webgpu"] })
    expect(progress).toHaveBeenLastCalledWith(3, 3)
    expect(mocks.fetch).toHaveBeenCalledWith("https://model.example/local.onnx")
  })

  it("保留产品默认远程模型固定缓存键，命中时不再下载", async () => {
    const match = vi
      .fn<(key: string) => Promise<Response | undefined>>()
      .mockResolvedValue(new Response(new Uint8Array([4, 5])))
    vi.stubGlobal("caches", {
      open: vi
        .fn<(name: string) => Promise<{ match: typeof match }>>()
        .mockResolvedValue({ match }),
    })
    await LayoutModelRunner.load(DEFAULT_MODEL_URL)
    expect(match).toHaveBeenCalledWith(
      "https://layout-model-cache.local/doclayout_yolo_docstructbench_imgsz1024.onnx",
    )
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

it("内置模型更新后读取实际打包字节，不套用旧远程缓存", async () => {
  const match = vi
    .fn<() => Promise<Response>>()
    .mockImplementation(async () => new Response(new Uint8Array([9, 9])))
  vi.stubGlobal("caches", {
    open: vi.fn<(name: string) => Promise<{ match: typeof match }>>().mockResolvedValue({ match }),
  })
  mocks.create.mockReset().mockResolvedValue({ inputNames: ["images"] })
  mocks.fetch
    .mockReset()
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])))
    .mockResolvedValueOnce(new Response(new Uint8Array([7, 8])))
  vi.stubGlobal("fetch", mocks.fetch)
  try {
    const url = "chrome-extension://verifier/doclayout_yolo.onnx"
    await LayoutModelRunner.load(url)
    await LayoutModelRunner.load(url)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.create.mock.calls.map((call) => [...call[0]])).toEqual([
      [1, 2],
      [7, 8],
    ])
    expect(match).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

it("默认模型按 modelscope → huggingface → hf-mirror 顺序尝试，首源失败自动续试", async () => {
  const MODEL_SCOPE_URL =
    "https://modelscope.cn/models/AI-ModelScope/DocLayout-YOLO-DocStructBench-onnx/resolve/master/doclayout_yolo_docstructbench_imgsz1024.onnx"
  mocks.fetch
    .mockReset()
    // mockReset 会清掉 beforeEach 的默认 resolve，这里重建序列：
    // modelscope 500 → 继续尝试 huggingface.co 成功
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
  vi.stubGlobal("fetch", mocks.fetch)
  try {
    await LayoutModelRunner.load(DEFAULT_MODEL_URL)
    expect(mocks.fetch.mock.calls.map(([u]) => u)).toEqual([MODEL_SCOPE_URL, DEFAULT_MODEL_URL])
  } finally {
    vi.unstubAllGlobals()
  }
})

it("三个下载源两轮重试后仍不可达时明确报错，不再无限等待", async () => {
  vi.stubGlobal("caches", undefined)
  mocks.fetch.mockReset().mockResolvedValue(new Response(null, { status: 500 }))
  vi.stubGlobal("fetch", mocks.fetch)
  try {
    await expect(LayoutModelRunner.load(DEFAULT_MODEL_URL)).rejects.toThrow(
      "all sources unreachable",
    )
    // 两轮 × 三源 = 6 次尝试
    expect(mocks.fetch).toHaveBeenCalledTimes(6)
  } finally {
    vi.unstubAllGlobals()
  }
})

it("第一轮全灭时第二轮放宽超时重试，命中即成功", async () => {
  vi.stubGlobal("caches", undefined)
  const MODEL_SCOPE_URL =
    "https://modelscope.cn/models/AI-ModelScope/DocLayout-YOLO-DocStructBench-onnx/resolve/master/doclayout_yolo_docstructbench_imgsz1024.onnx"
  const HF_MIRROR_URL =
    "https://hf-mirror.com/wybxc/DocLayout-YOLO-DocStructBench-onnx/resolve/main/doclayout_yolo_docstructbench_imgsz1024.onnx"
  mocks.fetch
    .mockReset()
    // 第一轮三源全 500 → 第二轮从 modelscope 再试，命中
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
  vi.stubGlobal("fetch", mocks.fetch)
  try {
    await LayoutModelRunner.load(DEFAULT_MODEL_URL)
    expect(mocks.fetch.mock.calls.map(([u]) => u)).toEqual([
      MODEL_SCOPE_URL,
      DEFAULT_MODEL_URL,
      HF_MIRROR_URL,
      MODEL_SCOPE_URL,
    ])
  } finally {
    vi.unstubAllGlobals()
  }
})

it("内置模型缺失时明确失败，不偷偷改用远程模型", async () => {
  vi.stubGlobal("caches", undefined)
  mocks.fetch.mockReset().mockResolvedValue(new Response(null, { status: 404 }))
  vi.stubGlobal("fetch", mocks.fetch)
  try {
    await expect(
      LayoutModelRunner.load("chrome-extension://verifier/doclayout_yolo.onnx"),
    ).rejects.toThrow("404")
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  } finally {
    vi.unstubAllGlobals()
  }
})
