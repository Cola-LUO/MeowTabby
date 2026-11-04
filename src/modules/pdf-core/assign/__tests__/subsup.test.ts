import type { Region } from "../../layout/model-runner"
import type { PdfTextItem } from "../../pdf/text-items"
import { describe, expect, it } from "vitest"
import { assignItems, buildLines } from "../assign"

const pageH = 792
const region: Region = {
  x1: -10,
  y1: 0,
  x2: 1000,
  y2: pageH,
  className: "plain text",
  behavior: "translate",
  conf: 1,
}

/** 构造 item：y = 字形盒顶 = 基线 + 0.8·h（text-items.ts 的 ASCENT 约定），w = 字符数×5 */
function mk(str: string, x: number, baseline: number, h: number): PdfTextItem {
  return { str, x, y: baseline + 0.8 * h, w: str.length * 5, h, order: 0, fontName: "f1" }
}

/** 带 w 的 mk：真实字形宽度与字符数不成比例（"model" h5 实宽 12.5） */
function mkw(str: string, x: number, baseline: number, h: number, w: number): PdfTextItem {
  return { str, x, y: baseline + 0.8 * h, w, h, order: 0, fontName: "f1" }
}

describe("上/下标挂回基线行（buildLines 两遍式）", () => {
  it("上标（悬在基线行上方、盒重叠）挂回其基线行，而不是自成一行", () => {
    // 正文 "Where"（h10，盒 [578,588]）+ 上标 "i"（h7，盒 [574.7,581.7]，与正文盒重叠）+ 下一行 "and"
    const items = [
      mk("Where", 10, 580, 10),
      mk("i", 30.5, 576.1, 7),
      mk("and", 10, 556, 10), // 行盒 [554,564]，与上标盒距 10.7 > 0.55×10，不可挂
    ]
    const lines = buildLines(items)
    const base = lines.find((l) => l.items.some((i) => i.str === "Where"))!
    expect(base.items.map((i) => i.str)).toContain("i")
    // 上标没把 "and" 拖进同一行
    const lower = lines.find((l) => l.items.some((i) => i.str === "and"))!
    expect(lower.items.map((i) => i.str)).not.toContain("i")
  })

  it("下标（悬在基线行盒下方 ≤0.55 行高）挂回其基线行", () => {
    // 下标 "model"（h5，盒 [572.2,577.2]）悬在行盒 [578,588] 下方 0.8（0.08×行高）
    const items = [mk("Where", 10, 580, 10), mk("model", 20, 573.2, 5), mk("is", 60, 580, 10)]
    const lines = buildLines(items)
    const base = lines.find((l) => l.items.some((i) => i.str === "Where"))!
    expect(base.items.map((i) => i.str)).toContain("model")
  })
})

// 【2026-09-14 决定】相信版面模型的分块：块内同一水平行一律视为同一行，不再按横向间隙切分。
// 下面的期望值随之改写——原先"同 y 跨栏碎片保持切分"的行为被显式放弃（跨栏改由"认领严格在框内"保证；
// 极少数整页大框串栏的兜底思路见 错误调试日记.md，当前不实现）。
describe("行内不再按横向间隙切段（相信 YOLO 分块）", () => {
  it("公式洞（大间隙 + 间隙里有悬出下标）：整行成一段", () => {
    // "AAA"(0-15) 与 "BBB"(38-53) 间隙 23px；下标 "x"(h5) 悬在行盒下方 2.8，挂回后落在洞的位置
    const items = [mk("AAA", 0, 580, 10), mk("x", 25, 573.2, 5), mk("BBB", 38, 580, 10)]
    const blocks = assignItems(items, [region], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    expect(paras).toHaveLength(1)
    expect(paras[0]!.text).toBe("AAA x BBB")
  })

  it("同 y 的两栏碎片合并成一段（已知代价：该框若真跨栏会串栏）", () => {
    const items = [
      // header 补句号：2026-09-22 起"段末行"判据另需句末标点（短行不再单独构成段界）
      mk("header header.", 0, 590, 10),
      mk("AAAA", 0, 580, 10),
      mk("BBBB", 300, 580, 10),
    ]
    const blocks = assignItems(items, [region], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    // 段1 = 短行 header（段末行判据）；段2 里 AAAA 与 BBBB 同段 = 不再被横向间隙切开
    expect(paras.map((p) => p.text)).toEqual(["header header.", "AAAA BBBB"])
  })

  it("栏沟里的散点同样并入该行（同一水平行不区分结构）", () => {
    const items = [
      mk("header header.", 0, 590, 10), // 同上：段末行需以句末标点收尾
      mk("AAAA", 0, 580, 10), // 行盒 [578,588]
      mk("0123456789", 150, 584, 5), // 小 item，挂回该行后落在 AAAA 与 BBBB 之间
      mk("BBBB", 300, 580, 10),
    ]
    const blocks = assignItems(items, [region], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    expect(paras.map((p) => p.text)).toEqual(["header header.", "AAAA 0123456789 BBBB"])
  })

  it("Pass 3 未挂载的小 item 同 y 合并成一行（不再按大间隙切开）", () => {
    const items = [mk("body text line", 0, 580, 10), mk("ab", 0, 660, 5), mk("cd", 200, 660, 5)]
    const lines = buildLines(items)
    const smallLines = lines.filter((l) => l.items.some((i) => i.h === 5))
    expect(smallLines).toHaveLength(1)
    expect(smallLines[0]!.text).toBe("ab cd")
  })
})

describe("含公式的段落整体送翻译（公式判定已移除，交由大模型处理）", () => {
  it("实测段落复刻：下标随正文进译文、段落不被切碎", () => {
    // 行内全貌（h10 基线 580）：where W i ∈ R model k end，其中 i/model/k 是 h5 小 item
    // （1:1 复刻 "W_i^Q ∈ R^{d_model×d_k}" 的结构）。整段必须合成一段完整送给翻译引擎，
    // 上下标文字原样保留在文本里（大模型对公式的理解比占位符裁图好）
    const items = [
      mkw("where ", 0, 580, 10, 35),
      mkw("W", 35, 580, 10, 9),
      mkw("i", 44, 573.2, 5, 3),
      mkw("∈", 48, 580, 10, 7),
      mkw("R", 56, 580, 10, 7),
      mkw("model", 63, 573.2, 5, 13),
      mkw("k", 76, 573.2, 5, 3),
      mkw("end", 87, 580, 10, 20),
    ]
    const blocks = assignItems(items, [region], 612, pageH)
    const paras = blocks.flatMap((b) => b.paras)
    expect(paras).toHaveLength(1)
    expect(paras[0]!.text).toBe("where Wi∈Rmodelk end")
    expect(paras[0]!.text).toContain("model")
    // 段落盒包住悬挂下标（Paragraph.y 存盒底 y-up：行盒底 578 → 下标盒底 572.2，h 相应外扩）
    expect(paras[0]!.y).toBeCloseTo(572.2, 1)
    expect(paras[0]!.h).toBeCloseTo(15.8, 1)
  })
})
