import type { PdfTextItem } from "../../pdf/text-items"
import type { Region } from "../model-runner"
import { describe, expect, it } from "vitest"
import { assignItems } from "../../assign/assign"
import { repairRegions } from "../repair"

const pageH = 792

// 第 4 页 3.2 标题实测几何（small-caps 碎片，经 normalizeItems 预合并后的形态）+ YOLO 实测紧框
function heading(): PdfTextItem[] {
  const mk = (str: string, x: number, w: number, h: number): PdfTextItem => ({
    str,
    x,
    y: 542 + 0.8 * h,
    w,
    h,
    order: 0,
    fontName: "f1",
  })
  return [
    mk("3.2", 108.2, 13.4, 10),
    mk("LAYOUT", 132.2, 35.3, 10),
    mk("GENERATION", 170.5, 56.4, 10),
    mk(": E", 227.3, 12.4, 10),
    mk("NSURING", 240.3, 38.4, 8),
    mk("LAYOUT", 281.6, 35.4, 10),
    mk("DIVERSITY", 320.0, 47.4, 10),
  ]
}
// css y-down y1=241.9, y2=252.6 → y-up [539.4, 550.1]
const tightTitle: Region = {
  x1: 157.8,
  y1: 539.4,
  x2: 343.4,
  y2: 550.1,
  className: "title",
  behavior: "translate",
  conf: 1,
}

describe("repairRegions 孤立行吸收", () => {
  it("3.2 案例：紧框沿孤立行吸收两端碎片，正文完整成一个翻译单元", () => {
    const repaired = repairRegions([tightTitle], heading())
    expect(repaired).toHaveLength(1)
    // LAYOUT（左，6 字母）与 DIVERSITY（右，9 字母）被吸收进框
    expect(repaired[0]!.x1).toBeLessThanOrEqual(131.5)
    expect(repaired[0]!.x2).toBeGreaterThanOrEqual(367.4)
    const blocks = assignItems(heading(), repaired, 612, pageH)
    const paras = blocks.filter((b) => b.behavior === "translate").flatMap((b) => b.paras)
    // "3.2"（间隙 36px > 25px 不吸）留在孤儿块；其余整句一个单元
    const main = paras.find((p) => p.text.includes("GENERATION"))!
    expect(main.text).toBe("LAYOUT GENERATION: ENSURING LAYOUT DIVERSITY")
    expect(paras.some((p) => p.text.includes("IVERSITY") && !p.text.includes("DIVERSITY"))).toBe(
      false,
    )
  })

  it("每侧滚动预算 10 字母：候选片段超长时停止吸收", () => {
    // 紧贴框左缘的 20 字母片段（间隙 12.8px 在吸收范围内，但超出预算）；
    // 标题自身的 LAYOUT（6 字母）仍被正常吸收 → x1 = 131.2；若无预算会吸到 x1 = 54
    const long: PdfTextItem = {
      str: "a".repeat(20),
      x: 55,
      y: 550,
      w: 90,
      h: 10,
      order: 0,
      fontName: "f1",
    }
    const repaired = repairRegions([tightTitle], [long, ...heading()])
    const title = repaired.find((r) => r.className === "title")!
    expect(title.x1).toBeCloseTo(131.2, 1)
    expect(title.x2).toBeGreaterThanOrEqual(367.4)
  })

  it("不抢邻居：候选 item 已属于其它区域时不吸收", () => {
    const bodyRegion: Region = {
      x1: 100,
      y1: 539.4,
      x2: 156,
      y2: 550.1,
      className: "plain text",
      behavior: "translate",
      conf: 1,
    }
    const repaired = repairRegions([tightTitle, bodyRegion], heading())
    const title = repaired.find((r) => r.className === "title")!
    expect(title.x1).toBeCloseTo(157.8, 0)
  })

  it("不吞图表：候选 item 在 keep 区域内时不吸收", () => {
    const keep: Region = {
      x1: 100,
      y1: 539.4,
      x2: 156,
      y2: 550.1,
      className: "figure",
      behavior: "keep",
      conf: 1,
    }
    const repaired = repairRegions([tightTitle, keep], heading())
    const title = repaired.find((r) => r.className === "title")!
    expect(title.x1).toBeCloseTo(157.8, 0)
  })

  it("非孤立行不吸收：多行正文区域纵向上不满足隔离，框保持原样", () => {
    const body: Region = {
      x1: 108,
      y1: 495,
      x2: 500,
      y2: 515,
      className: "plain text",
      behavior: "translate",
      conf: 1,
    }
    const items: PdfTextItem[] = [
      { str: "first line of body text", x: 108, y: 512, w: 120, h: 10, order: 0, fontName: "f1" },
      { str: "second line of body text", x: 108, y: 501, w: 130, h: 10, order: 0, fontName: "f1" },
      { str: "third line below the box", x: 108, y: 490, w: 125, h: 10, order: 0, fontName: "f1" },
    ]
    const repaired = repairRegions([body], items)
    expect(repaired[0]!.y1).toBe(495)
    expect(repaired[0]!.y2).toBe(515)
  })

  it("同类重叠合并：两个 translate 区域重叠过半时取包络", () => {
    const a: Region = {
      x1: 100,
      y1: 500,
      x2: 300,
      y2: 530,
      className: "plain text",
      behavior: "translate",
      conf: 0.9,
    }
    const b: Region = {
      x1: 150,
      y1: 505,
      x2: 350,
      y2: 535,
      className: "plain text",
      behavior: "translate",
      conf: 0.8,
    }
    const repaired = repairRegions([a, b], [])
    expect(repaired).toHaveLength(1)
    expect(repaired[0]!.x1).toBe(100)
    expect(repaired[0]!.x2).toBe(350)
  })
})
