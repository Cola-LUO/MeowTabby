import type { Region } from "../../layout/model-runner"
import type { PdfTextItem } from "../../pdf/text-items"
import { describe, expect, it } from "vitest"
import { normalizeItems } from "../../pdf/text-items"
import { assignItems } from "../assign"

const pageH = 792

// 第 4 页 3.2 标题的实测几何：small-caps 字距排版，首字母大写与后续小 caps 是分离 item
// （x/w 取自 pdf.js 实测值；y=字形盒顶 552）
function headingRaw() {
  const mk = (str: string, x: number, w: number, h: number) => ({
    str,
    transform: [10, 0, 0, 10, x, 542],
    width: w,
    height: h,
    order: 0,
    fontName: "f1",
  })
  return [
    mk("3.2", 108.2, 13.4, 10),
    mk("L", 132.2, 6.1, 10),
    mk("AYOUT", 138.7, 28.8, 8),
    mk("G", 170.5, 7.2, 10),
    mk("ENERATION", 178.2, 48.6, 8),
    mk(": E", 227.3, 12.4, 10),
    mk("NSURING", 240.3, 38.4, 8),
    mk("L", 281.6, 6.1, 10),
    mk("AYOUT", 288.2, 28.8, 8),
    mk("D", 320.0, 7.2, 10),
    mk("IVERSITY", 327.7, 39.7, 8),
  ]
}

function heading(): PdfTextItem[] {
  return normalizeItems(headingRaw())
}

describe("small-caps 标题碎片的归位", () => {
  it("首字母大写+小 caps 紧邻碎片（同字体、间隙≤1.5px）预合并为完整单词", () => {
    const strs = heading().map((i) => i.str)
    expect(strs).toContain("LAYOUT")
    expect(strs).toContain("DIVERSITY")
    expect(strs).not.toContain("IVERSITY")
    expect(strs).toContain("3.2") // 词间大间隙（10.6px）不合并
  })

  it("孤儿标题整行合并为一段：完整词序翻译，无碎片块", () => {
    const blocks = assignItems(heading(), [], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    expect(paras).toHaveLength(1)
    expect(paras[0]!.text).toBe("3.2 LAYOUT GENERATION: ENSURING LAYOUT DIVERSITY")
  })

  it("标题行被 YOLO 紧框截断时，框外碎片合并为一段（不再是 3.2/LAYOUT/IVERSITY 各自乱翻）", () => {
    // 实测 title 区域：x 157.8→343.4（css y-down），罩住标题中段、漏掉两端。
    // DIVERSITY 合并后中心 x=343.7 恰好落在框外 0.3px → 归孤儿；无论落在哪侧都必须是完整词
    const region: Region = {
      x1: 157.8,
      y1: 792 - 252.6,
      x2: 343.4,
      y2: 792 - 241.9,
      className: "title",
      behavior: "translate",
      conf: 1,
    }
    const blocks = assignItems(heading(), [region], 612, pageH)
    const regionText = blocks
      .filter((b) => b.region !== null)
      .flatMap((b) => b.paras.map((p) => p.text))
      .join(" ")
    const orphanParas = blocks.filter((b) => b.region === null).flatMap((b) => b.paras)
    expect(regionText).toContain("GENERATION")
    expect(orphanParas.filter((p) => p.y > 530)).toHaveLength(1)
    expect(orphanParas.find((p) => p.y > 530)!.text).toBe("3.2 LAYOUT DIVERSITY")
    const allParas = blocks.flatMap((b) => b.paras).map((p) => p.text.trim())
    expect(allParas).not.toContain("IVERSITY")
    expect(allParas.join(" ")).not.toContain("{{")
  })

  it("纵向隔离按行判定：页面上还有其它孤儿行（如公式编号）时，孤立标题行的碎片依然合并", () => {
    // 复刻真实第 4 页：孤儿块里除了标题碎片（y≈549.5）还有别处的孤儿行（y≈242 的公式编号）
    const region: Region = {
      x1: 157.8,
      y1: 792 - 252.6,
      x2: 343.4,
      y2: 792 - 241.9,
      className: "title",
      behavior: "translate",
      conf: 1,
    }
    const eqNo: PdfTextItem = { str: "(3)", x: 480, y: 250, w: 14, h: 10, order: 0, fontName: "f5" }
    const blocks = assignItems([...heading(), eqNo], [region], 612, pageH)
    const orphanParas = blocks.filter((b) => b.region === null).flatMap((b) => b.paras)
    const headingPara = orphanParas.find((p) => p.y > 530)!
    expect(headingPara.text).toBe("3.2 LAYOUT DIVERSITY")
  })
})
