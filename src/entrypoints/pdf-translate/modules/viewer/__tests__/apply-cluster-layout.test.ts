/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { applyClusterLayout } from "../apply-cluster-layout"

function mkBox(): HTMLElement {
  const d = document.createElement("div")
  d.className = "trans-cluster"
  d.textContent = "译文"
  d.dataset.baseFontSize = "10"
  return d
}

describe("applyClusterLayout：DOM 写入", () => {
  it("写 height / fontSize / lineHeight", () => {
    const box = mkBox()
    applyClusterLayout(box, {
      scale: 0.9,
      lineHeight: 1.6,
      height: 52,
      overflow: false,
      contentHeight: 50,
    })
    expect(box.style.height).toBe("52px")
    expect(box.style.fontSize).toBe("9px") // 基准字号 10 × 0.9
    expect(box.style.lineHeight).toBe("1.6")
  })

  it("溢出 → 保留统计标记，不添加渐变遮罩", () => {
    const box = mkBox()
    const layout = { scale: 1, lineHeight: 1.3, height: 52, overflow: true, contentHeight: 80 }
    applyClusterLayout(box, layout)
    applyClusterLayout(box, layout)
    expect(box.classList.contains("trans-cluster--overflow")).toBe(true)
    expect(box.children).toHaveLength(0)
  })

  it("不溢出 → 移除溢出统计标记", () => {
    const box = mkBox()
    applyClusterLayout(box, {
      scale: 1,
      lineHeight: 1.3,
      height: 52,
      overflow: true,
      contentHeight: 80,
    })
    applyClusterLayout(box, {
      scale: 1,
      lineHeight: 1.3,
      height: 52,
      overflow: false,
      contentHeight: 40,
    })
    expect(box.classList.contains("trans-cluster--overflow")).toBe(false)
    expect(box.children).toHaveLength(0)
  })

  it("缺 dataset.baseFontSize 时回退到 inline font-size", () => {
    const box = mkBox()
    delete box.dataset.baseFontSize
    box.style.fontSize = "12px"
    applyClusterLayout(box, {
      scale: 0.5,
      lineHeight: 1.3,
      height: 30,
      overflow: false,
      contentHeight: 30,
    })
    expect(box.style.fontSize).toBe("6px")
  })
})
