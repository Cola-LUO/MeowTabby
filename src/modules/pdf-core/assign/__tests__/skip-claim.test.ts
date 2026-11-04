import type { Region } from "../../layout/model-runner"
import type { PdfTextItem } from "../../pdf/text-items"
// skip(abandon) 区域的认领规则（2026-09-14）
// 背景：abandon 区域原先【不认领】，框内文字全掉进"整页兜底块"——多个区域的文字被并成
// 一个跨页巨盒（实测污水检测第 1 页 x52-421 / y38-752、714px 高、263k px²），白底盖住半页。
// 现在改成：skip 也认领自己的文字，**各自成块成盒**（跟着自己的区域走）；
// 认领顺序硬约束：题注原框 → keep 原框 → 其他可翻译原框 → keep 外扩 → skip，
// 避免高置信误标抢走正文
// （01_arxiv 第 1 页实测 abandon 误标覆盖 36% 正文）。
import { describe, expect, it } from "vitest"
import { assignItems, isKeepOnlyItem, rendersText, type AssignedBlock } from "../assign"

const pageH = 792

/** item.y = 字形盒顶（y-up），盒 = [y-h, y]；归属判定用盒中心 */
const item = (str: string, x: number, y: number, w: number, h = 10): PdfTextItem => ({
  str,
  x,
  y,
  w,
  h,
  order: 0,
  fontName: "f",
})

const region = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  className: string,
  behavior: Region["behavior"],
  conf = 0.9,
): Region => ({ x1, y1, x2, y2, className, behavior, conf })

describe("skip(abandon) 区域认领自己的文字", () => {
  it("两个相邻 abandon 区域各自成块，不再被兜底块合成一个跨页盒", () => {
    const items = [
      item("SCIENCE OF THE TOTAL ENVIRONMENT", 180, 760, 240, 10), // 页眉：盒 [750,760]
      item("available at www.sciencedirect.com", 100, 668, 260, 8), // 横幅：盒 [660,668]
    ]
    const regions = [
      region(170, 748, 430, 762, "abandon", "skip", 0.83), // 页眉框
      region(90, 655, 450, 670, "abandon", "skip", 0.97), // 横幅框
    ]
    const blocks = assignItems(items, regions, 595, pageH)
    const rendered = blocks.filter(rendersText)
    expect(rendered).toHaveLength(2) // 一个区域一个块
    expect(rendered.map((b) => b.behavior)).toEqual(["skip", "skip"])
    expect(rendered.map((b) => b.paras.map((p) => p.text))).toEqual([
      ["SCIENCE OF THE TOTAL ENVIRONMENT"], // 区域顺序：页眉在前
      ["available at www.sciencedirect.com"],
    ])
    // 关键：不再产生"装别人文字"的兜底块
    expect(blocks.find((b) => b.region === null && b.paras.length > 0)).toBeUndefined()
  })

  it("认领顺序 translate 先于 skip：高置信 abandon 框盖住正文时，正文仍归 translate", () => {
    const items = [item("body text of the article", 60, 710, 300, 10)]
    const regions = [
      region(50, 690, 500, 710, "abandon", "skip", 0.96), // 误标，置信度最高
      region(50, 690, 500, 710, "plain text", "translate", 0.4),
    ]
    const blocks = assignItems(items, regions, 595, pageH)
    const body = blocks.find((b) => b.behavior === "translate" && b.region !== null)!
    expect(body.paras.map((p) => p.text)).toEqual(["body text of the article"])
    expect(blocks.find((b) => b.behavior === "skip")!.paras).toHaveLength(0)
  })

  it("skip 不认领 keep 区内的文字（图内文字仍留在原图、不产生译文块）", () => {
    const items = [item("axis label", 60, 710, 40, 8)]
    const regions = [
      region(50, 690, 500, 710, "figure", "keep"),
      region(50, 690, 500, 710, "abandon", "skip"),
    ]
    const blocks = assignItems(items, regions, 595, pageH)
    expect(blocks.filter(rendersText)).toHaveLength(0)
    expect(blocks.find((b) => b.behavior === "keep")).toBeDefined()
  })
})

describe("题注、keep 与正文的认领优先级", () => {
  it("题注原框优先于表格原框和外扩范围", () => {
    const items = [item("Table 3. Comparisons", 60, 627.68, 200)] // 中心 y=622.68
    const regions = [
      region(50, 628, 550, 700, "table", "keep"), // 底边外扩后到 y=622
      region(50, 595, 550, 630, "table_caption", "translate", 0.3),
    ]
    const blocks = assignItems(items, regions, 612, pageH)
    expect(blocks[0]!.paras).toHaveLength(0)
    expect(blocks[1]!.paras.map((p) => p.text)).toEqual(["Table 3. Comparisons"])
    expect(isKeepOnlyItem(items[0]!, regions)).toBe(false)
  })

  it("keep 原框优先于普通正文误检框", () => {
    const items = [item("axis label", 60, 650, 80)]
    const regions = [
      region(50, 620, 200, 680, "figure", "keep"),
      region(50, 620, 200, 680, "plain text", "translate", 0.99),
    ]
    const blocks = assignItems(items, regions, 612, pageH)
    expect(blocks[1]!.paras).toHaveLength(0)
    expect(blocks.find((b) => b.region === null)).toBeUndefined()
    expect(isKeepOnlyItem(items[0]!, regions)).toBe(true)
  })

  it("正文原框优先于 keep 外扩，无主图边文字仍归 keep", () => {
    const items = [item("body text", 60, 621, 80), item("axis", 160, 621, 30)]
    const regions = [
      region(50, 620, 200, 680, "figure", "keep"),
      region(50, 610, 120, 619, "plain text", "translate", 0.2),
    ]
    const blocks = assignItems(items, regions, 612, pageH)
    expect(blocks[1]!.paras.map((p) => p.text)).toEqual(["body text"])
    expect(blocks.find((b) => b.region === null)).toBeUndefined()
    expect(isKeepOnlyItem(items[0]!, regions)).toBe(false)
    expect(isKeepOnlyItem(items[1]!, regions)).toBe(true)
  })
})

describe("rendersText：会产出译文块（白底 + 送翻）的块", () => {
  const mk = (behavior: AssignedBlock["behavior"], n: number): AssignedBlock => ({
    minOrder: 0,
    region: null,
    behavior,
    paras: Array.from({ length: n }, () => ({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      text: "t",
      lineCount: 1,
      fontSize: 10,
      lines: [],
    })),
  })

  it("translate / skip 有段落 → true", () => {
    expect(rendersText(mk("translate", 1))).toBe(true)
    expect(rendersText(mk("skip", 1))).toBe(true)
  })

  it("keep 与空段块 → false（零覆盖、不建请求）", () => {
    expect(rendersText(mk("keep", 3))).toBe(false)
    expect(rendersText(mk("translate", 0))).toBe(false)
    expect(rendersText(mk("skip", 0))).toBe(false)
  })
})
