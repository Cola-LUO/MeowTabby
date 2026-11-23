import type { PDFPageProxy } from "pdfjs-dist"
import { describe, expect, it } from "vitest"
import { getTextItems, isBoldFont, normalizeItems } from "../text-items"

describe("normalizeItems", () => {
  it("从 pdf.js 原始 item 提取坐标/字体，y 修正为字形盒顶（基线 + 0.8·字高，y-up）", () => {
    const raw = [
      {
        str: "Hello",
        transform: [12, 0, 0, 12, 50, 700],
        width: 30,
        height: 12,
        fontName: "g_d0_f1",
      },
      { str: "", transform: [12, 0, 0, 12, 80, 700], width: 5, height: 12, fontName: "g_d0_f1" },
    ]
    const styles = { g_d0_f1: { fontFamily: "serif" } }
    const items = normalizeItems(raw, styles)
    expect(items).toHaveLength(1)
    // transform[5] 是基线；字形几乎全在基线上方，盒顶 = 700 + 12*0.8 = 709.6
    expect(items[0]).toMatchObject({
      str: "Hello",
      x: 50,
      y: 709.6,
      w: 30,
      h: 12,
      fontName: "g_d0_f1",
    })
  })

  it("旋转文字（如 arXiv 竖排侧边水印）被排除：其 x/y/w/h 语义失效，横向译文块也无法还原竖排", () => {
    const raw = [
      // 水平文字：矩阵 [a b c d e f]，b≈0 且 c≈0
      { str: "normal", transform: [10, 0, 0, 10, 100, 700], width: 40, height: 10, fontName: "f" },
      // 90° 旋转（顺时针）：基线方向 (0,-12)，竖排——width 实为页面上的纵向长度
      {
        str: "arXiv:2410.12628v1",
        transform: [0, -12, 12, 0, 30, 550],
        width: 350,
        height: 10,
        fontName: "f",
      },
      // 90° 旋转（逆时针）
      {
        str: "rotated ccw",
        transform: [0, 12, -12, 0, 60, 300],
        width: 80,
        height: 10,
        fontName: "f",
      },
    ]
    const items = normalizeItems(raw)
    expect(items.map((i) => i.str)).toEqual(["normal"])
  })

  it("传入 fontLookup 时仅对加粗字体写入 bold: true，常规字体不写入 bold 字段", () => {
    const raw = [
      { str: "Title", transform: [14, 0, 0, 14, 50, 700], width: 40, height: 14, fontName: "f_b" },
      { str: "Body", transform: [10, 0, 0, 10, 50, 680], width: 30, height: 10, fontName: "f_r" },
    ]
    const items = normalizeItems(raw, undefined, [0, 0], {
      f_b: { name: "TimesNewRomanPS-BoldMT" },
      f_r: { name: "TimesNewRomanPSMT" },
    })
    expect(items[0]?.bold).toBe(true)
    expect("bold" in items[1]!).toBe(false)
  })
})

describe("isBoldFont", () => {
  it("识别常见粗体字体名与 pdf.js 元数据标志", () => {
    expect(isBoldFont("g_d0_f1", { name: "TimesNewRomanPS-BoldMT" })).toBe(true)
    expect(isBoldFont("g_d0_f2", { name: "ABCDEF+NimbusRomNo9L-Medi" })).toBe(true)
    expect(isBoldFont("g_d0_f3", { name: "CMBX12" })).toBe(true)
    expect(isBoldFont("g_d0_f4", { name: "PingFangSC-Semibold" })).toBe(true)
    expect(isBoldFont("g_d0_f5", { name: "SimHei" })).toBe(true)
    expect(isBoldFont("g_d0_f6", { bold: true })).toBe(true)
    expect(isBoldFont("g_d0_f7", { black: true })).toBe(true)
  })

  it("常规字体及包含 media 等子串的非粗体名不误判", () => {
    expect(isBoldFont("g_d0_f1", { name: "Times-Roman" })).toBe(false)
    expect(isBoldFont("g_d0_f2", { name: "CMR10" })).toBe(false)
    expect(isBoldFont("g_d0_f3", { name: "MultimediaFont" })).toBe(false)
    expect(isBoldFont("g_d0_f1")).toBe(false)
  })
})

describe("getTextItems", () => {
  it("从 page.commonObjs 读取真实字体元数据并标记 bold", async () => {
    const fonts = new Map<string, { name?: string; bold?: boolean }>([
      ["g_d0_f1", { name: "ABCDEF+NimbusRomNo9L-Medi" }],
      ["g_d0_f2", { name: "ABCDEF+NimbusRomNo9L-Regu" }],
    ])
    const mockPage = {
      view: [0, 0, 595, 842],
      commonObjs: {
        has: (k: string) => fonts.has(k),
        get: (k: string) => fonts.get(k),
      },
      getTextContent: async () => ({
        items: [
          {
            str: "Attention Is All You Need",
            transform: [17, 0, 0, 17, 100, 700],
            width: 200,
            height: 17,
            fontName: "g_d0_f1",
          },
          {
            str: "Abstract",
            transform: [10, 0, 0, 10, 100, 650],
            width: 40,
            height: 10,
            fontName: "g_d0_f2",
          },
        ],
        styles: {},
      }),
    } as unknown as PDFPageProxy
    const items = await getTextItems(mockPage)
    expect(items[0]?.bold).toBe(true)
    expect(items[1]?.bold).toBeUndefined()
  })
})
