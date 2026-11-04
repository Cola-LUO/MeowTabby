import type { Region } from "../../layout/model-runner"
import type { PdfTextItem } from "../../pdf/text-items"
import type { AssignedBlock, Paragraph } from "../assign"
// 段落识别升级（2026-09-14）单测：行距基准取"文档典型行距"、新增"段末行 + 首行缩进"断段判据。
// 背景：原先只有"框内行距中位数 ×1.3"一条判据，实测在 R4 那种框上退化为 6px，
// 且判不出"段间距≈行距"的论文（只能靠首行缩进/段末行这类版式特征）。
import { describe, expect, it } from "vitest"
import { assignItems, dropFloatingParas, estimateBaseLeading } from "../assign"

const pageH = 792

function reg(x1: number, y1: number, x2: number, y2: number): Region {
  return { x1, y1, x2, y2, className: "plain text", behavior: "translate", conf: 1 }
}

/** item：y = 字形盒顶 = 基线 + 0.8·h（text-items.ts 的 ASCENT 约定）；宽度显式给，便于复刻实测几何 */
function mkw(str: string, x: number, baseline: number, h: number, w: number): PdfTextItem {
  return { str, x, y: baseline + 0.8 * h, w, h, order: 0, fontName: "f1" }
}

describe("段落识别：段末行 / 首行缩进（2026-09-14 新增；2026-09-22 起另需句末标点 + 段首非小写）", () => {
  it("上一行以句号收尾、本行回到段左缘且首字母大写 → 断段（行距正常也能判出换段）", () => {
    const items = [
      mkw("p1 line1", 0, 700, 10, 400), // 满宽
      mkw("p1 end.", 0, 689.1, 10, 200), // 段末行：右缘距块右缘 200px，且以句末标点收尾
      mkw("P2 line1", 0, 678.2, 10, 400), // 段首行：不以小写字母开头
      mkw("p2 line2", 0, 667.3, 10, 400),
    ]
    const blocks = assignItems(items, [reg(-10, 600, 500, pageH)], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    expect(paras.map((p) => p.text)).toEqual(["p1 line1 p1 end.", "P2 line1 p2 line2"])
  })

  it("上一行以句号收尾、本行首行缩进 15px 且首字母大写 → 断段", () => {
    const items = [
      mkw("p1 line1", 0, 700, 10, 400),
      mkw("p1 end.", 0, 689.1, 10, 200),
      mkw("P2 indented first line", 15, 678.2, 10, 385), // 首行缩进 15px
      mkw("p2 line2", 0, 667.3, 10, 400),
    ]
    const blocks = assignItems(items, [reg(-10, 600, 500, pageH)], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    expect(paras.map((p) => p.text)).toEqual([
      "p1 line1 p1 end.",
      "P2 indented first line p2 line2",
    ])
  })

  it("悬挂缩进的列表续行不被误切：4 个列表项 = 4 段（续行以句号收尾，项首行非小写）", () => {
    // 复刻实测 R8 的形状：项首行左对齐满宽，续行缩进 16px 且很短
    const items: PdfTextItem[] = []
    const base = [700, 678.2, 656.4, 634.6]
    base.forEach((y, k) => {
      items.push(mkw(`(${k + 1}) item ${k + 1} first line`, 0, y, 10, 400))
      items.push(mkw(`continued ${k + 1}.`, 16, y - 10.9, 10, 150))
    })
    const blocks = assignItems(items, [reg(-10, 560, 500, pageH)], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    expect(paras).toHaveLength(4)
    paras.forEach((p, k) => {
      expect(p.text).toContain(`item ${k + 1} first line`)
      expect(p.text).toContain(`continued ${k + 1}`)
    })
  })
})

describe("段落边界：句末标点 + 段首非小写（2026-09-22 新增）", () => {
  it("上一行短但无句末标点 → 不断段（右缘参差文档的段内短行不再被误切）", () => {
    const items = [
      mkw("P1 line1", 0, 700, 10, 400),
      mkw("p1 end without period", 0, 689.1, 10, 200),
      mkw("P2 line1", 0, 678.2, 10, 400),
      mkw("p2 line2", 0, 667.3, 10, 400),
    ]
    const blocks = assignItems(items, [reg(-10, 600, 500, pageH)], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    expect(paras).toHaveLength(1)
  })

  it("上一行以句末标点收尾，但下一行以小写字母开头 → 不断段", () => {
    const items = [
      mkw("P1 line1", 0, 700, 10, 400),
      mkw("p1 end.", 0, 689.1, 10, 200),
      mkw("p2 line1", 0, 678.2, 10, 400),
      mkw("p2 line2", 0, 667.3, 10, 400),
    ]
    const blocks = assignItems(items, [reg(-10, 600, 500, pageH)], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    expect(paras).toHaveLength(1)
  })

  it("下一行以汉字开头（无大小写概念）→ 不反对型放行，仍断段", () => {
    const items = [
      mkw("P1 line1", 0, 700, 10, 400),
      mkw("p1 end.", 0, 689.1, 10, 200),
      mkw("第二段首行", 0, 678.2, 10, 400),
      mkw("第二段次行", 0, 667.3, 10, 400),
    ]
    const blocks = assignItems(items, [reg(-10, 600, 500, pageH)], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    expect(paras.map((p) => p.text)).toEqual(["P1 line1 p1 end.", "第二段首行 第二段次行"])
  })
})

describe("段落识别：行距基准", () => {
  it("基准 = 各框内部行距中位数的中位数（单个框间距大不会把整页基准抬高）", () => {
    // A/C 两框行距 10px（典型），B 框行距 15px → 典型行距取 10 → B 的 15px 行距判为换段
    const a = reg(-10, 660, 120, pageH)
    const c = reg(140, 600, 270, 700)
    const b = reg(290, 540, 420, 640)
    const items = [
      mkw("a1", 0, 700, 10, 100),
      mkw("a2", 0, 690, 10, 100),
      mkw("c1", 150, 650, 10, 100),
      mkw("c2", 150, 640, 10, 100),
      mkw("b1", 300, 600, 10, 100),
      mkw("b2", 300, 585, 10, 100), // 行距 15
    ]
    const blocks = assignItems(items, [a, c, b], 612, pageH)
    const parasOf = (r: Region) => blocks.find((bl) => bl.region === r)!.paras
    expect(parasOf(a)).toHaveLength(1)
    expect(parasOf(c)).toHaveLength(1)
    expect(parasOf(b)).toHaveLength(2) // 15px ≈ 1.5×典型行距 → 换段
  })
})

describe("段落识别：行内公式不再切碎句子（R4 实测几何复刻）", () => {
  it("同一视觉行被公式洞切开 → 仍是一段完整句子", () => {
    const items = [
      mkw("One may also consider a weighted combination of R", 108, 700, 10, 220),
      mkw("emp", 330, 693, 5, 13), // 下标（落在公式洞的位置）
      mkw("and R", 346, 700, 10, 25.5),
      mkw("dist", 373, 693, 5, 14), // 下标
      mkw(", but we focus on the above", 388, 700, 10, 116),
      mkw(
        "objective since we are interested in understanding each objective individually.",
        108,
        689.1,
        10,
        310,
      ),
    ]
    const blocks = assignItems(items, [reg(100, 660, 520, pageH)], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    expect(paras).toHaveLength(1)
    const text = paras[0]!.text
    expect(text).toContain("One may also consider a weighted combination of R")
    expect(text).toContain("and R")
    expect(text).toContain("emp")
    expect(text).toContain("dist")
    expect(text).toContain("objective individually.")
  })
})

describe("漂浮干扰项丢弃（dropFloatingParas）", () => {
  function para(text: string, x: number, y: number, w: number, h: number): Paragraph {
    return { x, y, w, h, text, lineCount: 1, fontSize: h, lines: [] }
  }
  function block(region: Region | null, ...paras: Paragraph[]): AssignedBlock {
    return { minOrder: 0, region, behavior: "translate", paras }
  }

  it("纵向远离所有其它段落的碎片（页码/公式编号）被丢弃，正文与短标题保留", () => {
    const body = block(reg(0, 300, 500, 500), para("body text of the paragraph", 0, 400, 300, 10))
    const pageNo = block(null, para("3", 300, 700, 5, 10)) // 孤儿块：页码
    const title = block(
      { ...reg(0, 500, 500, 620), className: "title" },
      para("3 Method", 0, 600, 50, 12),
    )
    const dropped = dropFloatingParas([body, pageNo, title], 10)
    expect(dropped).toEqual({ count: 1, len: 1 })
    expect(pageNo.paras).toHaveLength(0)
    expect(body.paras).toHaveLength(1) // 正文不动
    expect(title.paras).toHaveLength(1) // title 块豁免
  })

  it("不孤立的短段不丢（附近有其它段落）", () => {
    const b = block(
      reg(0, 300, 500, 500),
      para("body line", 0, 380, 100, 10),
      para("12", 0, 396, 10, 10),
    )
    const dropped = dropFloatingParas([b], 10)
    expect(dropped).toEqual({ count: 0, len: 0 })
    expect(b.paras).toHaveLength(2)
  })

  it("estimateBaseLeading：取各框内部行距中位数的中位数", () => {
    const a = reg(-10, 660, 120, pageH)
    const c = reg(140, 600, 270, 700)
    const b = reg(290, 540, 420, 640)
    const items = [
      mkw("a1", 0, 700, 10, 100),
      mkw("a2", 0, 690, 10, 100),
      mkw("c1", 150, 650, 10, 100),
      mkw("c2", 150, 640, 10, 100),
      mkw("b1", 300, 600, 10, 100),
      mkw("b2", 300, 585, 10, 100),
    ]
    expect(estimateBaseLeading(items, [a, c, b])).toBe(10)
  })
})
