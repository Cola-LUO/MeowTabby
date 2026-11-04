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
