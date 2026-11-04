import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { it } from "vitest"
import { assignItems, buildLines } from "../assign/assign"
import { normalizeItems, type PdfTextItem } from "../pdf/text-items"

function item(str: string, x: number, w: number, y = 100, h = 10): PdfTextItem {
  return { str, x, w, y, h, fontName: "font", order: 0 }
}

function normalize(items: PdfTextItem[]) {
  return normalizeItems(
    items.map((textItem) => ({
      str: textItem.str,
      transform: [textItem.h, 0, 0, textItem.h, textItem.x, textItem.y - 0.8 * textItem.h],
      width: textItem.w,
      height: textItem.h,
      fontName: textItem.fontName,
    })),
  )
}

it("010 第七页的行末句点不能与下一行 However 预合并", () => {
  const items = normalize([
    item(".", 284.145, 2.6, 172.517),
    item("However,", 47.278, 36.587, 161.063),
  ])
  assert.deepEqual(
    items.map((textItem) => textItem.str),
    [".", "However,"],
  )
  assert.ok(items.every((textItem) => textItem.w > 0))
})

it("预合并保留同基线的小型大写字母，并用实际边缘计算外框", () => {
  const [merged] = normalize([item("A", 10, 8, 109.6, 12), item("UTHOR", 18.5, 32, 108, 10)])
  assert.equal(merged!.str, "AUTHOR")
  assert.equal(merged!.x, 10)
  assert.equal(merged!.w, 40.5)
  assert.ok(merged!.y - merged!.h <= 98)
})

it("盒顶靠近但基线错开、纵向重叠不足的文字分别成行", () => {
  assert.equal(buildLines([item("upper", 0, 40), item("lower", 50, 40, 95)]).length, 2)
  assert.equal(buildLines([item("big", 0, 30, 120, 30), item("small text", 40, 50, 116)]).length, 2)
})

it("同基线不同字高和普通两端对齐空白仍归同一行", () => {
  const lines = buildLines([item("Title", 0, 30, 112.8, 16), item("body text", 42, 50, 108)])
  assert.equal(lines.length, 1)
  assert.equal(lines[0]!.text, "Title body text")
})

it("同一 YOLO 框内的同行文字不因横向大空白拆行或断段", () => {
  const items = [item("formula left", 10, 50), item("formula right", 120, 50)]
  const lines = buildLines(items)
  assert.equal(lines.length, 1)
  assert.equal(lines[0]!.text, "formula left formula right")
  const [block] = assignItems(
    items,
    [
      {
        x1: 0,
        y1: 0,
        x2: 200,
        y2: 150,
        className: "plain text",
        conf: 1,
        behavior: "translate",
      },
    ],
    200,
    150,
  )
  assert.deepEqual(
    block!.paras.map((p) => p.text),
    ["formula left formula right"],
  )
})

it("左右栏由各自的 YOLO 框保持分开", () => {
  const items = [item("left column", 10, 50), item("right column", 120, 50)]
  const blocks = assignItems(
    items,
    [
      { x1: 0, y1: 0, x2: 80, y2: 150, className: "plain text", conf: 1, behavior: "translate" },
      { x1: 110, y1: 0, x2: 200, y2: 150, className: "plain text", conf: 1, behavior: "translate" },
    ],
    200,
    150,
  )
  assert.deepEqual(
    blocks.map((block) => block.paras.map((p) => p.text)),
    [["left column"], ["right column"]],
  )
})

it("上下标挂回后同步行文字，避免正文与行摘要不一致", () => {
  const lines = buildLines([item("H", 0, 8), item("2", 8, 4, 97, 6), item("O", 13, 8)])
  assert.equal(lines.length, 1)
  assert.equal(lines[0]!.text, "H2O")
  assert.equal(lines[0]!.items.length, 3)
})

it("上下标优先挂到纵向相接的行，不能因邻行恰好有空隙而跳行", () => {
  const script = item("-1", 13, 4, 101, 4)
  const lines = buildLines([
    item("prior", 0, 10, 112, 8),
    item("line", 20, 40, 112, 8),
    item("next text", 0, 70, 100, 8),
    script,
  ])
  assert.equal(lines.find((line) => line.items.includes(script))!.y, 100)
})

it("行尾上标可以略超出正文右缘，不能因此挂到上一行", () => {
  const script = item("-1", 72, 4, 101, 4)
  const lines = buildLines([
    item("prior line", 0, 80, 112, 8),
    item("next text", 0, 70, 100, 8),
    script,
  ])
  assert.equal(lines.find((line) => line.items.includes(script))!.y, 100)
})

it("行框覆盖所有正文 item 的最外缘", () => {
  const [line] = buildLines([item("wide text", 0, 100), item("mark", 80, 5)])
  assert.equal(line!.w, 100)
})

it("压盖纠正不能把文字移到远处无关行", () => {
  const lines = buildLines([
    item("original", 0, 20),
    item("mark", 0, 10, 99),
    item("unrelated", 50, 40, 50),
  ])
  assert.equal(
    lines.find((line) => line.items.some((textItem) => textItem.str === "unrelated"))!.items.length,
    1,
  )
})

// 从两篇实际 PDF 的 getTextContent 输出截取，保留公式小字、作者标记与原始输出顺序。
const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/text-lines.json", import.meta.url), "utf8"),
)

it("010 第七页截图的完整段落为 19 行，公式小字不单独成段", () => {
  const fixture = fixtures.paragraph010
  const items = normalizeItems(fixture.items, undefined, fixture.origin)
  const lines = buildLines(items)
  assert.ok(items.every((textItem) => textItem.w >= 0))
  assert.equal(lines.length, 19)
  assert.ok(lines[7]!.text.startsWith("shown by comparable"))
  assert.ok(lines[7]!.text.endsWith("."))
  assert.ok(lines[7]!.w > 230)
  assert.ok(lines[8]!.text.startsWith("However,"))
  const [block] = assignItems(
    items,
    [
      {
        x1: 40,
        y1: 40,
        x2: 290,
        y2: 270,
        className: "plain text",
        conf: 1,
        behavior: "translate",
      },
    ],
    600,
    800,
  )
  assert.equal(block!.paras.length, 1)
  assert.equal(block!.paras[0]!.lineCount, 19)
})

it("008 作者行保留姓名与全部上标、通讯作者标记", () => {
  const fixture = fixtures.authors008
  const items = normalizeItems(fixture.items, undefined, fixture.origin)
  const lines = buildLines(items)
  assert.equal(lines.length, 1)
  assert.equal(lines[0]!.items.length, items.length)
  assert.equal(
    lines[0]!.text,
    "Minghua Nie a, Yi Yang b,c, Zhijian Zhang a, Caixia Yan c, Xiaoning Wang a, Hongjing Li a,⇑, Wenbo Dong a,⇑",
  )
})

it("010 第五页长下标接回公式，整段不因假空白拆开", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/010-p5-long-subscript.json", import.meta.url), "utf8"),
  )
  const items = normalizeItems(fixture.items, undefined, fixture.origin)
  const lines = buildLines(items)
  assert.equal(lines.length, 17)
  assert.ok(lines[4]!.text.includes("dimethylaniline;ClO2"))
  assert.ok(lines[4]!.text.endsWith("(Neta"))
  assert.ok(lines[5]!.text.startsWith("et al., 1988))"))
  const [block] = assignItems(
    items,
    [
      {
        x1: 300,
        y1: 150,
        x2: 550,
        y2: 340,
        className: "plain text",
        conf: 1,
        behavior: "translate",
      },
    ],
    595.276,
    793.701,
  )
  assert.equal(block!.paras.length, 1)
  assert.equal(block!.paras[0]!.lineCount, 17)
  assert.match(block!.paras[0]!.text, /\(Neta et al\., 1988\)\)/)
})

it("远离正文的长小字仍独立成行", () => {
  const lines = buildLines([
    item("ordinary body text with enough characters", 0, 150),
    item("unrelated small text", 0, 60, 50, 6),
  ])
  assert.equal(lines.length, 2)
  assert.equal(lines[0]!.text, "ordinary body text with enough characters")
  assert.equal(lines[1]!.text, "unrelated small text")
})
