import type { PdfTextItem } from "../pdf/text-items"
import { describe, expect, it } from "vitest"
import { assignItems, type AssignedBlock } from "../assign/assign"
import { TAIL_HEAD_WEIGHTS, planFlatMerges } from "../assign/cross-merge"
import { walkReadingOrder } from "../assign/reading-order"

describe("D 唯一默认路径", () => {
  it("区域内悬挂条目无开关也固定按首行切段", () => {
    const rows: Array<[number, string]> = [
      [10, "Alpha first"],
      [30, "continuation one"],
      [30, "continuation two"],
      [10, "Beta first"],
      [30, "continuation three"],
      [30, "continuation four"],
      [10, "Gamma first"],
      [30, "continuation five"],
    ]
    const items: PdfTextItem[] = rows.map(([x, str], order) => ({
      str,
      x,
      y: 180 - order * 14,
      w: 80,
      h: 10,
      fontName: "F1",
      order,
    }))
    expect(
      assignItems(
        items,
        [
          {
            x1: 0,
            y1: 0,
            x2: 150,
            y2: 200,
            className: "plain text",
            conf: 0.9,
            behavior: "translate",
          },
        ],
        150,
        200,
      )[0]!.paras.map((p) => p.lineCount),
    ).toEqual([3, 3, 2])
  })

  it("独立公式扩宽固定截到每侧 0.155 页宽", () => {
    const rows = [
      ["112", "plain text", 107, 568, 505, 595],
      ["公式22", "isolate_formula", 261, 614, 350, 629],
      ["114", "plain text", 107, 633, 209, 646],
      ["公式23", "isolate_formula", 232, 666, 379, 681],
      ["113", "plain text", 107, 690, 291, 703],
    ] as const
    const blocks = rows.map(
      ([text, className, left, top, right, bottom], minOrder): AssignedBlock => ({
        region: {
          className,
          x1: left,
          y1: 792 - bottom,
          x2: right,
          y2: 792 - top,
          conf: 1,
          behavior: className === "plain text" ? "translate" : "keep",
        },
        behavior: className === "plain text" ? "translate" : "keep",
        paras:
          className === "plain text"
            ? [
                {
                  text,
                  x: left,
                  y: 792 - bottom,
                  w: right - left,
                  h: bottom - top,
                  lineCount: 1,
                  fontSize: 10,
                  lines: [],
                },
              ]
            : [],
        minOrder,
      }),
    )
    expect(
      walkReadingOrder(blocks, 612, 17).seq.flatMap((b) => b.paras.map((p) => p.text)),
    ).toEqual(["112", "114", "113"])
  })

  it("配对固定 D 权重与 49 阈值", () => {
    expect(TAIL_HEAD_WEIGHTS.widthNear).toBe(10)
    expect(TAIL_HEAD_WEIGHTS.tailNoSentenceEnd).toBe(15)
    const block = (x: number): AssignedBlock => ({
      region: {
        x1: x,
        x2: x + 100,
        y1: 10,
        y2: 50,
        className: "plain text",
        conf: 1,
        behavior: "translate",
      },
      behavior: "translate",
      minOrder: x,
      paras: [
        {
          x,
          y: 10,
          w: 100,
          h: 30,
          text: "continued text",
          fontSize: 10,
          lineCount: 2,
          lines: [
            { x, w: 100, h: 10, text: "continued" },
            { x, w: 100, h: 10, text: "text" },
          ],
        },
      ],
    })
    const result = planFlatMerges([
      { block: block(0), page: 1 },
      { block: block(200), page: 1 },
    ])
    expect(result.decisions[0]!.threshold).toBe(49)
    expect(result.groups).toHaveLength(1)
  })
})
