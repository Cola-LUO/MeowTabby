import { describe, expect, it } from "vitest"
import { letterbox } from "../preprocess"

describe("letterbox", () => {
  it("纵向 A4 页缩放到 1024，左右对称补边", () => {
    // 595×794 → scale = 1024/794 ≈ 1.2897；resizedW = round(595×1.2897) ≈ 767
    const lb = letterbox(595, 794, 1024, 32)
    expect(lb.scale).toBeCloseTo(1024 / 794, 5)
    expect(lb.resizedH).toBeLessThanOrEqual(1024)
    expect(lb.resizedW).toBeLessThanOrEqual(1024)
    // 补边后总尺寸是 stride 的倍数
    expect((1024 - lb.resizedW) % 32).toBe(0)
    expect((1024 - lb.resizedH) % 32).toBe(0)
  })
  it("横向页以宽为基准", () => {
    const lb = letterbox(794, 595, 1024, 32)
    expect(lb.scale).toBeCloseTo(1024 / 794, 5)
  })
})
