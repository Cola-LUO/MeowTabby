import { describe, expect, it } from "vitest"
import { LH_INCREASE_CAP, fitLineHeight } from "../fit-line-height"

/** 内容高与行高的线性模型：height = lines × fontSize × lineHeight（与 text-metrics 同口径） */
function measureOf(lines: number, fontSize: number) {
  return (lh: number) => lines * fontSize * lh
}

describe("fitLineHeight：行高只增不减", () => {
  it("单行不动 → n = 0", () => {
    const r = fitLineHeight({
      contentHeight: 13,
      targetHeight: 40,
      lineCount: 1,
      baseLineHeight: 1.3,
      measure: () => 13,
    })
    expect(r).toEqual({ lineHeight: 1.3, increase: 0 })
  })

  it("n < 0.1 不动（增量太小，拉了反而更难看）", () => {
    // 2 行 × 10px × 1.3 = 26；目标 27 → n = 27/26*1.3-1.3 ≈ 0.05
    const r = fitLineHeight({
      contentHeight: 26,
      targetHeight: 27,
      lineCount: 2,
      baseLineHeight: 1.3,
      measure: measureOf(2, 10),
    })
    expect(r).toEqual({ lineHeight: 1.3, increase: 0 })
  })

  it("n < 0.3（小增量）：按 0.1 步长递增，取最后一个仍不超目标高的增量", () => {
    // 2 行 × 10px：目标 29px。lh=1.3→26；1.4→28（≤29，收）；1.5→30（超，停）→ 增量 0.1
    const r = fitLineHeight({
      contentHeight: 26,
      targetHeight: 29,
      lineCount: 2,
      baseLineHeight: 1.3,
      measure: measureOf(2, 10),
    })
    expect(r.increase).toBeCloseTo(0.1)
    expect(r.lineHeight).toBeCloseTo(1.4)
  })

  it("n >= 0.3（大增量）：跳测候选，取仍不超目标高的最大者", () => {
    // 2 行 × 10px：目标 52px → n = 1.3；候选 [1.2, 1.3, 1.4]
    // lh=2.5→50（≤52）；2.6→52（≤52）；2.7→54（超）→ 取 1.3
    const r = fitLineHeight({
      contentHeight: 26,
      targetHeight: 52,
      lineCount: 2,
      baseLineHeight: 1.3,
      measure: measureOf(2, 10),
    })
    expect(r.increase).toBeCloseTo(1.3)
    expect(r.lineHeight).toBeCloseTo(2.6)
  })

  it("跳测全失败 → 退回 0（保守取 0 = 不拉）", () => {
    const r = fitLineHeight({
      contentHeight: 26,
      targetHeight: 40,
      lineCount: 2,
      baseLineHeight: 1.3,
      measure: () => 100,
    })
    expect(r).toEqual({ lineHeight: 1.3, increase: 0 })
  })

  it("n >= 护栏（50）不动（护栏防'2 行撑 60 行'式荒谬行距）", () => {
    const r = fitLineHeight({
      contentHeight: 26,
      targetHeight: 26 * 60,
      lineCount: 2,
      baseLineHeight: 1.3,
      measure: measureOf(2, 10),
    })
    expect(r.increase).toBe(0)
    expect(LH_INCREASE_CAP).toBe(50)
  })

  it("目标高小于内容高（译文不短）→ 不动", () => {
    const r = fitLineHeight({
      contentHeight: 26,
      targetHeight: 20,
      lineCount: 2,
      baseLineHeight: 1.3,
      measure: measureOf(2, 10),
    })
    expect(r).toEqual({ lineHeight: 1.3, increase: 0 })
  })

  it("结果永不把行高降到 base 以下（只增不减）", () => {
    for (const target of [10, 20, 26, 30, 100]) {
      const r = fitLineHeight({
        contentHeight: 26,
        targetHeight: target,
        lineCount: 2,
        baseLineHeight: 1.3,
        measure: measureOf(2, 10),
      })
      expect(r.lineHeight).toBeGreaterThanOrEqual(1.3)
    }
  })
})
