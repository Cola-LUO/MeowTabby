import { describe, expect, it } from "vitest"
import { regionToUnrotated, blockDisplayTransform } from "@/modules/pdf-core/pdf/coords-rot"

describe("regionToUnrotated", () => {
  it("rotate=90：轴交换（spec 实测值）", () => {
    // 污水检测第 4 页：模型 table 区 display(x43.2,y48.5 → 738.8,542.9)，视口 794×595
    const box = regionToUnrotated({ x1: 43.2, y1: 48.5, x2: 738.8, y2: 542.9 }, 794, 595, 90)
    expect(box.x).toBeCloseTo(48.5, 1) // x_u = ry
    expect(box.y).toBeCloseTo(43.2, 1) // y_u = rx
    expect(box.w).toBeCloseTo(494.4, 1) // w_u = rh
    expect(box.h).toBeCloseTo(695.6, 1) // h_u = rw
  })
  it("rotate=270：对称映射（视口 595×794）", () => {
    const box = regionToUnrotated({ x1: 100, y1: 50, x2: 400, y2: 250 }, 595, 794, 270)
    expect(box.x).toBeCloseTo(794 - 250, 1)
    expect(box.y).toBeCloseTo(595 - 400, 1)
    expect(box.w).toBeCloseTo(200, 1)
    expect(box.h).toBeCloseTo(300, 1)
  })
  it("rotate=180：中心镜像", () => {
    const box = regionToUnrotated({ x1: 100, y1: 50, x2: 400, y2: 250 }, 794, 595, 180)
    expect(box.x).toBeCloseTo(794 - 400, 1)
    expect(box.y).toBeCloseTo(50, 1)
    expect(box.w).toBeCloseTo(300, 1)
    expect(box.h).toBeCloseTo(200, 1)
  })
  it("rotate=0：恒等", () => {
    const box = regionToUnrotated({ x1: 10, y1: 20, x2: 110, y2: 220 }, 794, 595, 0)
    expect(box).toEqual({ x: 10, y: 20, w: 100, h: 200 })
  })
})

describe("blockDisplayTransform", () => {
  it("rotate=90：页眉块 unrotated(y755.4,x174.6,w34.5,h5.2) → display 左760.6/顶174.6 + rotate90", () => {
    // spec 实测：页眉块 unrotated y=755.4(含 ascent), x=174.6, w=34.5, h=5.2
    const t = blockDisplayTransform({ x: 174.6, y: 755.4, w: 34.5, h: 5.2 }, 595.28, 793.7, 90)
    expect(t.left).toBeCloseTo(755.4 + 5.2, 1) // L = y + h
    expect(t.top).toBeCloseTo(174.6, 1) // T = x
    expect(t.width).toBe(34.5)
    expect(t.height).toBe(5.2)
    expect(t.rotateDeg).toBe(90)
  })
  it("rotate=90：块显示范围 = pipeline y 区间（ascent 惯性与 rot0 一致）", () => {
    const t = blockDisplayTransform({ x: 174.6, y: 755.4, w: 34.5, h: 5.2 }, 595.28, 793.7, 90)
    expect(t.left - t.height).toBeCloseTo(755.4, 1) // displayX 下沿 = pipeline y
    expect(t.left).toBeCloseTo(760.6, 1)
  })
  it("rotate=270：对称", () => {
    const t = blockDisplayTransform({ x: 100, y: 300, w: 50, h: 20 }, 595.28, 793.7, 270)
    expect(t.left).toBeCloseTo(793.7 - 300 - 20, 1) // L = 页高 - y - h
    expect(t.top).toBeCloseTo(595.28 - 100, 1) // T = 页宽 - x
    expect(t.rotateDeg).toBe(-90)
  })
  it("rotate=0：恒等（无变换）", () => {
    const t = blockDisplayTransform({ x: 10, y: 20, w: 30, h: 40 }, 794, 595, 0)
    expect(t).toEqual({ left: 10, top: 20, width: 30, height: 40, rotateDeg: 0 })
  })
})
