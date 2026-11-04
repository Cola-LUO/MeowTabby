import type { PdfTextItem } from "../../pdf/text-items"
import type { Region } from "../model-runner"
import { describe, expect, it } from "vitest"
import { repairRegions } from "../repair"

/** 最小复现：一行字 a|bcdefghi|jk，框只罩住 bcdefghi，看补框是否把 a/jk 吸进来 */
function item(str: string, x: number, w: number): PdfTextItem {
  return { str, x, y: 100, w, h: 10, order: 0, fontName: "F1" }
}

function region(x1: number, x2: number): Region {
  // y-up：底 90、顶 102（行盒 90~100 在框内）
  return { x1, y1: 90, x2, y2: 102, className: "plain text", conf: 0.9, behavior: "translate" }
}

describe("repair 最小复现", () => {
  it("孤立行：a/jk 无主、间隙小 → 应吸进框", () => {
    const items = [item("a", 0, 8), item("bcdefghi", 10, 70), item("jk", 82, 16)]
    const regions = [region(10, 80)]
    const out = repairRegions(regions, items)
    console.log(`[函数级] 补框前 x: ${regions[0]!.x1} ~ ${regions[0]!.x2}（罩住 bcdefghi）`)
    console.log(`[函数级] 补框后 x: ${out[0]!.x1} ~ ${out[0]!.x2}（罩住 a~jk）`)
    expect(out[0]!.x1).toBeLessThanOrEqual(0) // 左缘应扩到 a 以外
    expect(out[0]!.x2).toBeGreaterThanOrEqual(98) // 右缘应扩到 jk 以外
  })

  it("D 补框允许非孤立行的相邻无主文字横向吸收", () => {
    const items = [
      item("a", 0, 8),
      item("bcdefghi", 10, 70),
      item("jk", 82, 16),
      // 第二行：y=85（与第一行 Δy=15 < 1.8×10=18 → 第一行不孤立）
      { ...item("lmnop", 10, 50), y: 85 },
    ]
    const regions = [region(10, 80)]
    const out = repairRegions(regions, items)
    expect(out[0]!.x1).toBe(-1)
    expect(out[0]!.x2).toBe(99)
  })

  it("a/jk 被另一个框认领（无主关卡拦住）→ 不吸", () => {
    const items = [item("a", 0, 8), item("bcdefghi", 10, 70), item("jk", 82, 16)]
    const regions = [region(10, 80), region(-5, 8)] // 左边还有个框罩住 a
    const out = repairRegions(regions, items)
    expect(out[0]!.x1).toBe(10)
  })
})
