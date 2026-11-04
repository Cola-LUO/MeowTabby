import type { Region } from "../layout/model-runner"
import { describe, expect, it } from "vitest"
import { analyzePage } from "../pipeline"

const raw: Region = {
  x1: 10,
  y1: 20,
  x2: 110,
  y2: 120,
  className: "plain text",
  conf: 0.9,
  behavior: "translate",
}

describe("共用单页管线", () => {
  it("同行公式说明保留原文，非同行公式说明继续翻译", () => {
    const regions: Region[] = [
      {
        x1: 20,
        y1: 20,
        x2: 110,
        y2: 40,
        className: "isolate_formula",
        conf: 0.9,
        behavior: "keep",
      },
      {
        x1: 120,
        y1: 20,
        x2: 180,
        y2: 40,
        className: "formula_caption",
        conf: 0.9,
        behavior: "translate",
      },
      {
        x1: 120,
        y1: 60,
        x2: 180,
        y2: 80,
        className: "formula_caption",
        conf: 0.9,
        behavior: "translate",
      },
    ]
    const page = analyzePage({
      index: 1,
      cssW: 200,
      cssH: 200,
      regions,
      items: [
        { str: "x + y", x: 30, y: 175, w: 50, h: 10, fontName: "F", order: 0 },
        { str: "(1)", x: 130, y: 175, w: 20, h: 10, fontName: "F", order: 1 },
        { str: "Formula 1", x: 130, y: 135, w: 45, h: 10, fontName: "F", order: 2 },
      ],
    })
    expect(page.regionsDown.map((r) => r.behavior)).toEqual(["keep", "keep", "translate"])
    expect(page.blocks[1]!.paras).toEqual([])
    expect(page.blocks[2]!.paras.map((p) => p.text)).toEqual(["Formula 1"])
    expect(regions[1]!.behavior).toBe("translate")
  })

  it("依次换坐标、补框、D归属、漂浮过滤、阅读序，并保留原始输入", () => {
    const input = {
      index: 2,
      cssW: 200,
      cssH: 300,
      items: [
        {
          str: "a paragraph with enough text",
          x: 20,
          y: 270,
          w: 80,
          h: 10,
          fontName: "F",
          order: 0,
        },
      ],
      regions: [raw],
    }
    const page = analyzePage(input)
    expect(page.regions).toEqual([raw])
    expect(page.pageWu).toBe(200)
    expect(page.pageHu).toBe(300)
    expect(page.regionsUp[0]).toMatchObject({ x1: 10, y1: 180, x2: 110, y2: 280 })
    expect(page.regionsDown[0]).toEqual(raw)
    expect(page.blocks[0]!.paras[0]!.text).toBe("a paragraph with enough text")
    expect(page.order).toEqual({ seq: [page.blocks[0]], total: 1, placed: 1 })
    expect(page.keepUp).toEqual([])
    expect(input.regions).toEqual([raw])
  })

  it("90度页把Box明确转换成Region字段，并交换页宽高", () => {
    const page = analyzePage({
      index: 1,
      cssW: 300,
      cssH: 200,
      rotate: 90,
      items: [],
      regions: [raw],
    })
    expect(page.pageWu).toBe(200)
    expect(page.pageHu).toBe(300)
    expect(page.regionsUp[0]).toMatchObject({ x1: 20, y1: 10, x2: 120, y2: 110 })
    expect(page.regionsDown[0]).toEqual(raw)
  })
})
