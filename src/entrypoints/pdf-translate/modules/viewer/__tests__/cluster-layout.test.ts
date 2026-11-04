import { describe, expect, it } from "vitest"
import { solveClusterLayout } from "../cluster-layout"
import { SCALE_STEPS } from "../fit-text"
import { LINE_HEIGHT } from "../text-metrics"

const base = { width: 100, baseFontSize: 10 } // 10px 字 → 每行 10 个中文字；单行高 13px

describe("solveClusterLayout 阶段2：短译文拉行高填满原位高（缺陷 ①）", () => {
  it("2 行译文 / 原位高 52 → 行高被拉高、盒高 = 原位高、不溢出", () => {
    const r = solveClusterLayout({ ...base, text: "中".repeat(20), minHeight: 52, availHeight: 52 })
    expect(r.scale).toBe(1)
    expect(r.lineHeight).toBeGreaterThan(LINE_HEIGHT)
    expect(r.height).toBeCloseTo(52)
    expect(r.overflow).toBe(false)
  })

  it("单行译文不动行高，盒高 = 原位高", () => {
    const r = solveClusterLayout({ ...base, text: "中".repeat(5), minHeight: 52, availHeight: 52 })
    expect(r.lineHeight).toBe(LINE_HEIGHT)
    expect(r.height).toBeCloseTo(52)
  })

  it("内容本就填满原位高 → 行高不动、盒高 = 内容高", () => {
    const r = solveClusterLayout({
      ...base,
      text: "中".repeat(40),
      minHeight: 52,
      availHeight: 200,
    })
    expect(r.lineHeight).toBe(LINE_HEIGHT)
    expect(r.height).toBeCloseTo(52)
  })
})

describe("solveClusterLayout：指定 lineHeight（实测复核用，跳过阶段 2 自适应拉高）", () => {
  it("指定行高后不再自适应拉高：盒高仍 = 原位高", () => {
    const pulled = solveClusterLayout({
      ...base,
      text: "中".repeat(20),
      minHeight: 52,
      availHeight: 52,
    })
    const fixed = solveClusterLayout({
      ...base,
      text: "中".repeat(20),
      minHeight: 52,
      availHeight: 52,
      lineHeight: LINE_HEIGHT,
    })
    expect(pulled.lineHeight).toBeGreaterThan(LINE_HEIGHT)
    expect(fixed.lineHeight).toBe(LINE_HEIGHT)
    expect(fixed.height).toBeCloseTo(52)
  })

  it("指定行高越小，内容高越小（复核逐档降行高的依据）", () => {
    const text = "中".repeat(20)
    const hi = solveClusterLayout({ ...base, text, minHeight: 52, availHeight: 52, lineHeight: 2 })
    const lo = solveClusterLayout({
      ...base,
      text,
      minHeight: 52,
      availHeight: 52,
      lineHeight: 1.5,
    })
    expect(lo.contentHeight).toBeLessThan(hi.contentHeight)
  })

  it("锁档位 + 指定行高：只降行高、字号不动", () => {
    const r = solveClusterLayout({
      ...base,
      text: "中".repeat(20),
      minHeight: 52,
      availHeight: 52,
      startScale: 1,
      scales: [1],
      lineHeight: 1.5,
    })
    expect(r.scale).toBe(1)
    expect(r.lineHeight).toBe(1.5)
  })
})

describe("solveClusterLayout 阶段1：长译文只缩字号不放", () => {
  it("装不下 → 降档，盒高 = 内容高（≤ 可用高）", () => {
    const r = solveClusterLayout({ ...base, text: "中".repeat(60), minHeight: 13, availHeight: 52 })
    expect(r.scale).toBeLessThan(1)
    expect(r.height).toBeLessThanOrEqual(52)
    expect(r.overflow).toBe(false)
  })

  it("档位到下限仍装不下 → overflow=true 且盒高 = 可用高（绝不越界）", () => {
    const r = solveClusterLayout({
      ...base,
      text: "中".repeat(400),
      minHeight: 13,
      availHeight: 52,
    })
    expect(r.scale).toBe(SCALE_STEPS[SCALE_STEPS.length - 1])
    expect(r.overflow).toBe(true)
    expect(r.height).toBeCloseTo(52)
  })

  it("startScale 是上界：合并组已降到 0.81 → 求解器不得升回 1", () => {
    const r = solveClusterLayout({
      ...base,
      text: "中".repeat(20),
      minHeight: 52,
      availHeight: 52,
      startScale: 0.81,
    })
    expect(r.scale).toBeLessThanOrEqual(0.81)
  })

  it("盒高恒 ≤ 可用高（结构保证，不靠事后补救）", () => {
    for (const avail of [13, 26, 52, 130]) {
      for (const len of [5, 20, 60, 200, 800]) {
        const r = solveClusterLayout({
          ...base,
          text: "中".repeat(len),
          minHeight: 13,
          availHeight: avail,
        })
        expect(r.height).toBeLessThanOrEqual(avail + 1e-6)
      }
    }
  })

  it("空译文 → 不溢出、盒高 = 原位高", () => {
    const r = solveClusterLayout({ ...base, text: "", minHeight: 26, availHeight: 52 })
    expect(r.overflow).toBe(false)
    expect(r.height).toBeCloseTo(26)
  })

  it("拉行高后内容高不超原位高（两阶段不打架）", () => {
    const r = solveClusterLayout({ ...base, text: "中".repeat(20), minHeight: 52, availHeight: 52 })
    expect(r.contentHeight).toBeLessThanOrEqual(52 + 1e-6)
  })
})
