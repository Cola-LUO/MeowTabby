import type { Region } from "../layout/model-runner"
import type { PdfTextItem } from "../pdf/text-items"
import assert from "node:assert/strict"
import { it } from "vitest"
import { assignItems } from "../assign/assign"

const item = (str: string, x: number, y: number, w: number): PdfTextItem => ({
  str,
  x,
  y,
  w,
  h: 10,
  fontName: "f",
  order: 0,
})
const region = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  className: string,
  behavior: Region["behavior"],
  conf = 0.9,
): Region => ({
  x1,
  y1,
  x2,
  y2,
  className,
  behavior,
  conf,
})

it("题注原框优先于表格原框和外扩范围", () => {
  const blocks = assignItems(
    [item("Table 3. Comparisons", 60, 627.68, 200)],
    [
      region(50, 628, 550, 700, "table", "keep"),
      region(50, 595, 550, 630, "table_caption", "translate", 0.3),
    ],
    612,
    792,
  )
  assert.equal(blocks[0]!.paras.length, 0)
  assert.deepEqual(
    blocks[1]!.paras.map((p) => p.text),
    ["Table 3. Comparisons"],
  )
})

it("keep 原框优先于普通正文误检框", () => {
  const blocks = assignItems(
    [item("axis label", 60, 650, 80)],
    [
      region(50, 620, 200, 680, "figure", "keep"),
      region(50, 620, 200, 680, "plain text", "translate", 0.99),
    ],
    612,
    792,
  )
  assert.equal(blocks[1]!.paras.length, 0)
})

it("正文原框优先于 keep 外扩，无主图边文字仍归 keep", () => {
  const blocks = assignItems(
    [item("body text", 60, 621, 80), item("axis", 160, 621, 30)],
    [
      region(50, 620, 200, 680, "figure", "keep"),
      region(50, 610, 120, 619, "plain text", "translate", 0.2),
    ],
    612,
    792,
  )
  assert.deepEqual(
    blocks[1]!.paras.map((p) => p.text),
    ["body text"],
  )
  assert.equal(
    blocks.find((b) => b.region === null),
    undefined,
  )
})
