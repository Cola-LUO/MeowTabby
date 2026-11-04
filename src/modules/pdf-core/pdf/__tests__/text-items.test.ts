import { describe, expect, it } from "vitest"
import { normalizeItems } from "../text-items"

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
})
