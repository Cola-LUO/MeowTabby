import type { AssignedBlock } from "@/modules/pdf-core/assign/assign"
import { describe, expect, it } from "vitest"
import { pageTypography } from "../page-typography"

function block(className: string, sizes: number[]): AssignedBlock {
  return {
    region: { x1: 0, y1: 0, x2: 100, y2: 100, className, behavior: "translate", conf: 1 },
    behavior: "translate",
    minOrder: 0,
    paras: sizes.map((fontSize) => ({
      x: 0,
      y: 0,
      w: 100,
      h: 20,
      text: "text",
      lineCount: 1,
      fontSize,
      lines: [],
    })),
  }
}

describe("pageTypography", () => {
  it("本页正文统一字号，接近的标题共用字号，行距参考原文", () => {
    const bodyA = block("plain text", [10, 10])
    const bodyB = block("plain text", [11])
    const titleA = block("title", [18])
    const titleB = block("title", [19])
    const titleLarge = block("title", [30])
    const style = pageTypography([bodyA, bodyB, titleA, titleB, titleLarge], 15, (b) =>
      b === titleA ? 30 : b === titleB ? 32 : 0,
    )
    expect(style.fontSizeFor(bodyA)).toBe(style.fontSizeFor(bodyB))
    expect(style.fontSizeFor(titleA)).toBe(style.fontSizeFor(titleB))
    expect(style.fontSizeFor(titleLarge)).toBeGreaterThan(style.fontSizeFor(titleA))
    expect(style.lineHeightFor(bodyA)).toBeCloseTo(15 / 9)
    expect(style.lineHeightFor(bodyB)).toBe(style.lineHeightFor(bodyA))
    expect(style.lineHeightFor(titleA)).toBeCloseTo(31 / (18.5 * 0.9))
    expect(style.lineHeightFor(titleB)).toBe(style.lineHeightFor(titleA))
  })
})
