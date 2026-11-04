/** 障碍距离（2026-09-16，跨栏合并组按容量分配 Task 1）
 *  纯几何、y-up 口径（与 Paragraph 一致：y = 底、h = 高；"下方" = y 减小方向）。
 *  锁住：合并组的"前盒"能向下吃多少空白 —— 到下方最近障碍上沿为止。 */
import { describe, expect, it } from "vitest"
import { availableHeightFor, regionToRect, type Rect } from "../obstacles"

const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

describe("regionToRect：y-up Region → 矩形", () => {
  it("x1/y1/x2/y2 → x/y/w/h", () => {
    expect(regionToRect({ x1: 50, y1: 600, x2: 250, y2: 700 })).toEqual({
      x: 50,
      y: 600,
      w: 200,
      h: 100,
    })
  })
})

describe("availableHeightFor：盒可向下吃到的总高", () => {
  it("下方无障碍 → 吃到页底（自身高 + 盒底到页底距离）", () => {
    expect(availableHeightFor(box(50, 700, 400, 10), [], 0)).toBe(710)
  })

  it("页底有边距 → 只吃到边距为止", () => {
    expect(availableHeightFor(box(50, 700, 400, 10), [], 40)).toBe(670)
  })

  it("下方最近障碍留出 10px → 可用高 = 自身高 + 10", () => {
    expect(availableHeightFor(box(50, 700, 400, 10), [box(50, 660, 400, 30)], 0)).toBe(20)
  })

  it("下方障碍紧贴盒底 → 只能用自己的原高（不得下吃）", () => {
    expect(availableHeightFor(box(50, 700, 400, 10), [box(50, 600, 400, 100)], 0)).toBe(10)
  })

  it("多个障碍取上沿最高（最近）的那个", () => {
    const obstacles = [box(50, 500, 400, 100), box(50, 650, 400, 30)] // 上沿 600 / 680
    expect(availableHeightFor(box(50, 700, 400, 10), obstacles, 0)).toBe(30) // 距 680 留 20
  })

  it("x 方向不重叠的障碍忽略（旁边那栏的盒不挡路）", () => {
    expect(availableHeightFor(box(50, 700, 400, 10), [box(500, 600, 80, 100)], 0)).toBe(710)
  })

  it("x 方向仅相切（重叠 ≤ 1px）不算障碍", () => {
    expect(availableHeightFor(box(50, 700, 400, 10), [box(449.5, 600, 100, 100)], 0)).toBe(710)
  })

  it("位于盒上方的障碍忽略", () => {
    expect(availableHeightFor(box(50, 700, 400, 10), [box(50, 720, 400, 20)], 0)).toBe(710)
  })

  it("与盒垂直重叠的障碍（侵入盒体）→ 视为不得下吃", () => {
    expect(availableHeightFor(box(50, 700, 400, 10), [box(50, 700, 400, 20)], 0)).toBe(10)
  })
})
