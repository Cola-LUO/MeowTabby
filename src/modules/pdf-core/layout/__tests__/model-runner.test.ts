import { describe, expect, it } from "vitest"

// 真模型集成验证：需要下载 71.8MB 模型 + 较长时间，CI/离线默认 skip（RUN_MODEL_IT=1 时执行）。
// huggingface.co 不可达的环境可用 MODEL_URL 指向镜像（如 hf-mirror.com）或本地 HTTP 服务。
const RUN = process.env.RUN_MODEL_IT === "1"
const MODEL_URL = process.env.MODEL_URL || undefined
// predictPage 依赖 OffscreenCanvas + 2D context，Node/jsdom 环境没有 → 自动跳过
const HAS_CANVAS = typeof document !== "undefined" && typeof OffscreenCanvas !== "undefined"

;(RUN ? describe : describe.skip)("LayoutModelRunner integration", () => {
  it("加载模型并解码出合理区域（张量直推，Node 可跑）", async () => {
    const { LayoutModelRunner } = await import("../model-runner")
    const runner = await LayoutModelRunner.load(MODEL_URL)
    expect(runner.names.length).toBeGreaterThan(0)
    expect(runner.loadMs).toBeLessThan(60_000)
    console.info(
      `[model-runner-it] backend=${runner.backend} loadMs=${Math.round(runner.loadMs)} names=${runner.names.length}`,
    )
    // 全灰 114 输入 ≈ 空白页，应输出 0 或极少区域
    const input = new Float32Array(3 * 1024 * 1024).fill(114 / 255)
    const regions = await runner.predictTensor(input, 595, 794)
    console.info(`[model-runner-it] blank-page regions=${regions.length}`)
    expect(regions.length).toBeLessThan(5)
  }, 120_000)

  ;(HAS_CANVAS ? it : it.skip)(
    "白页 canvas → predictPage",
    async () => {
      const { LayoutModelRunner } = await import("../model-runner")
      const runner = await LayoutModelRunner.load(MODEL_URL)
      const canvas = document.createElement("canvas")
      canvas.width = 1024
      canvas.height = 1024
      const ctx = canvas.getContext("2d")!
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const regions = await runner.predictPage(canvas, 595, 794)
      // oxlint-disable-next-line vitest/no-standalone-expect -- expect 在 (cond ? it : it.skip) 的回调里，规则识别不了条件调用
      expect(regions.length).toBeLessThan(5)
    },
    120_000,
  )
})
