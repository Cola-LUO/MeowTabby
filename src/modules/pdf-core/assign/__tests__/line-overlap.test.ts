import type { PdfTextItem } from "../../pdf/text-items"
// 行归属纠正（2026-09-16）单测：水平压盖排除 + 上下标挂行打分含垂直偏离。
// 几何全部取自 Non-local_Neural_Networks_CVPR2018.pdf 第 3 页实测坐标（见 test/_audit-loss.test.ts 审计报告）：
//   ∑  base=149.32 / x=179.88 / w=10.52（与上一行 item ") ="(175.55, w=15.74) 压盖 100%）
//   j  base=152.31 / x=216.14 / w=3.30（宿主行洞 7.41px；下行洞 3.32px ≈ j 宽）
import { describe, expect, it } from "vitest"
import { buildLines } from "../assign"

/** 构造 item：y = 字形盒顶 = 基线 + 0.8·h（text-items.ts 的 ASCENT 约定），w 显式给定 */
function mk(str: string, x: number, baseline: number, h: number, w: number): PdfTextItem {
  return { str, x, y: baseline + 0.8 * h, w, h, order: 0, fontName: "f1" }
}

/** 找出含指定 item（str + x 定位）的行 */
function lineOfStr(lines: ReturnType<typeof buildLines>, str: string, x: number) {
  return lines.find((l) => l.items.some((i) => i.str === str && Math.abs(i.x - x) < 0.5))
}

describe("行归属纠正：跨行压盖排除（groupIntoLines）", () => {
  it("D 将不满足同行条件的大算符保留为独立行，避免吸进上一行", () => {
    const items = [
      // 上一行（base 153.80）：") =" 覆盖 x 175.55–191.29
      mk("Here θ(x ) = W x and φ(x ) =", 50.11, 153.8, 9.96, 120),
      mk(") =", 175.55, 153.8, 9.96, 15.74),
      mk("W x are two embed-", 195.4, 153.8, 9.96, 92.62),
      // ∑：base 比上一行低 4.48（display 公式里大算符垂直居中），x 落在 ") =" 内部
      mk("∑", 179.88, 149.32, 9.96, 10.52),
      // 公式行（base 141.85）
      mk("dings. As above, we set C(x) =", 50.11, 141.85, 9.96, 112.62),
      mk("f(x , x ).", 200.77, 141.85, 9.96, 42),
    ]
    const lines = buildLines(items)

    const sigma = lineOfStr(lines, "∑", 179.88)!
    expect(sigma).toBeDefined()
    expect(sigma.text).toBe("∑")
    expect(sigma.y).toBeCloseTo(149.32 + 0.8 * 9.96, 1)

    const upper = lines.find((l) => l.text.includes("Here"))!
    expect(upper.items.some((i) => i.str === "∑")).toBe(false)
    expect(upper.text).not.toContain("∑")
  })

  it("相邻正文行之间不发生迁移（无压盖时纠正轮不改行为）", () => {
    const items = [
      mk("first line of body text", 50.11, 153.8, 9.96, 200),
      mk("second line of body text", 50.11, 141.85, 9.96, 205),
    ]
    const lines = buildLines(items)
    expect(lines).toHaveLength(2)
    expect(lines[0]!.items).toHaveLength(1)
    expect(lines[1]!.items).toHaveLength(1)
  })
})

describe("上下标挂行：打分含垂直偏离（attachSubsup）", () => {
  it("下标 j 不被'下一行恰好有同宽缝隙'骗走，挂回自己的宿主行", () => {
    const items = [
      // 宿主行（base 153.80）：W(195.40–204.81) + x(210.10–216.15)，其后 are(223.56) → 洞 7.41px
      mk("W", 195.4, 153.8, 9.96, 9.41),
      mk("x", 210.1, 153.8, 9.96, 6.05),
      mk("are two embeddings.", 223.56, 153.8, 9.96, 64.46),
      // 下一行（base 141.85）：x(210.59–216.64) 与 ,(219.96) 之间恰好 3.32px 缝 ≈ j 宽 3.30
      mk("f", 200.77, 141.85, 9.96, 4.88),
      mk("(", 206.72, 141.85, 9.96, 3.87),
      mk("x", 210.59, 141.85, 9.96, 6.05),
      mk(",", 219.96, 141.85, 9.96, 2.77),
      mk("x", 224.38, 141.85, 9.96, 6.05),
      mk(")", 234.63, 141.85, 9.96, 3.87),
      // j：base 152.31（与宿主行基差 1.49、与下一行基差 10.46）
      mk("j", 216.14, 152.31, 6.97, 3.3),
    ]
    const lines = buildLines(items)
    const jLine = lineOfStr(lines, "j", 216.14)!
    expect(jLine).toBeDefined()
    expect(jLine.y).toBeCloseTo(161.77, 1) // 宿主行 y = 153.80 + 0.8×9.96

    const lower = lines.find((l) => l.text.includes("f(x , x )"))!
    expect(lower.items.some((i) => i.str === "j")).toBe(false)
  })

  it("正常下标（与宿主紧邻、不压盖）行为不变", () => {
    const items = [
      mk("Here θ(x ) = W x and", 50.11, 153.8, 9.96, 105),
      mk("W", 111.11, 153.8, 9.96, 9.41),
      mk("θ", 120.52, 152.31, 6.97, 3.79), // W_θ 的下标，紧邻宿主右缘（120.52 = 111.11+9.41）
      mk("x", 125.03, 153.8, 9.96, 6.05),
    ]
    const lines = buildLines(items)
    const theta = lineOfStr(lines, "θ", 120.52)!
    expect(theta).toBeDefined()
    expect(theta.y).toBeCloseTo(161.77, 1)
  })
})
