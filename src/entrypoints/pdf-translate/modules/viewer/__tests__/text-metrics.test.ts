import { describe, expect, it } from "vitest"
import { LINE_HEIGHT, charWidth, contentSize, rowsNeeded } from "../text-metrics"

describe("charWidth：字宽估算口径（与 fit-text 同源，改数即改判据）", () => {
  it("CJK（含全角标点）1em / ASCII 0.55em / 空格 0.28em / 其他 0.6em", () => {
    expect(charWidth("中", 10)).toBe(10)
    expect(charWidth("，", 10)).toBe(10) // 全角标点落在 CJK 区间
    expect(charWidth("a", 10)).toBeCloseTo(5.5)
    expect(charWidth(" ", 10)).toBeCloseTo(2.8)
    expect(charWidth("-", 10)).toBeCloseTo(6) // 半角符号才是"其他"档
  })
})

describe("rowsNeeded：折行行数", () => {
  it("100px 宽 / 10px 字：中文每行 10 字，25 字 → 3 行", () => {
    expect(rowsNeeded("中".repeat(25), 10, 100)).toBe(3)
  })
  it("显式换行符另起一行", () => {
    expect(rowsNeeded("甲乙\n丙丁", 10, 100)).toBe(2)
  })
  it("空串算 1 行（盒内总要占一行）", () => {
    expect(rowsNeeded("", 10, 100)).toBe(1)
  })
})

describe("contentSize：内容高", () => {
  it("height = 行数 × 字号 × 行高", () => {
    const s = contentSize("中".repeat(25), 100, 10)
    expect(s.lines).toBe(3)
    expect(s.height).toBeCloseTo(3 * 10 * LINE_HEIGHT)
  })
  it("行高可覆盖（求解器拉行高后要重算）", () => {
    expect(contentSize("中".repeat(25), 100, 10, 2).height).toBeCloseTo(3 * 10 * 2)
  })
})
