/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest"
import { createDebugPanel } from "../debug-panel"

describe("debug panel", () => {
  beforeEach(() => {
    document.body.replaceChildren()
    document.body.className = ""
  })

  it("默认折叠按钮，点击设置展开，点击内部不收起，点击外部收起", () => {
    createDebugPanel(document, { classes: [] })
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="设置"]')
    expect(toggle).not.toBeNull()
    const actions = document.getElementById(toggle!.getAttribute("aria-controls")!)!
    expect(toggle!.querySelector("svg")).not.toBeNull()
    expect(actions.hidden).toBe(true)
    expect(toggle!.getAttribute("aria-expanded")).toBe("false")

    toggle!.click()
    expect(actions.hidden).toBe(false)
    expect(toggle!.getAttribute("aria-expanded")).toBe("true")
    actions.click()
    expect(actions.hidden).toBe(false)

    document.body.click()
    expect(actions.hidden).toBe(true)
    expect(toggle!.getAttribute("aria-expanded")).toBe("false")

    toggle!.click()
    toggle!.click()
    expect(actions.hidden).toBe(true)
  })

  it("展开后仍可打开和收起高级选项覆盖面板", () => {
    const p = createDebugPanel(document, { classes: [] })
    document.body.appendChild(p.root)
    document.querySelector<HTMLButtonElement>('button[aria-label="设置"]')!.click()
    document.querySelector<HTMLButtonElement>(".adv-toggle")!.click()
    expect(p.root.classList.contains("open")).toBe(true)
    expect(document.body.classList.contains("pdf-debug-open")).toBe(true)

    const close = Array.from(p.root.querySelectorAll("button")).find(
      (b) => b.textContent === "收起",
    )!
    close.click()
    expect(p.root.classList.contains("open")).toBe(false)
    expect(document.body.classList.contains("pdf-debug-open")).toBe(false)
  })

  it("渲染类别复选/滑杆/性能区，过滤生效", () => {
    const p = createDebugPanel(document, { classes: ["title", "figure"] })
    document.body.appendChild(p.root)
    expect(p.root.querySelectorAll("input[type=checkbox]")).toHaveLength(3)
    const boxes = p.root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[2]!
    expect(boxes.checked).toBe(false)
    let visible = false
    p.onBoxesVisibilityChange = (value) => {
      visible = value
    }
    boxes.click()
    expect(visible).toBe(true)
    expect(p.root.querySelector("input[type=range]")).toBeTruthy()
    // 默认全选；默认阈值 0.25（用户口径 20~30%）
    expect(
      p.regionsVisible([
        { x1: 0, y1: 0, x2: 10, y2: 10, className: "title", conf: 0.9, behavior: "translate" },
        { x1: 0, y1: 0, x2: 10, y2: 10, className: "figure", conf: 0.4, behavior: "keep" },
        { x1: 0, y1: 0, x2: 10, y2: 10, className: "plain text", conf: 0.2, behavior: "translate" },
      ]),
    ).toHaveLength(2) // 0.4 通过默认阈值，0.2 被置信度滑杆过滤
  })
  it("report() 显示本页检测耗时并累计总用时", () => {
    const p = createDebugPanel(document, { classes: [] })
    document.body.appendChild(p.root)
    p.report(1, 15, 567.4)
    expect(p.root.querySelector(".perf")?.textContent).toBe(
      "页面已检测至第1/15页 本页用时567ms 总用时567ms",
    )
    p.report(9, 15, 319.4)
    expect(p.root.querySelector(".perf")?.textContent).toBe(
      "页面已检测至第9/15页 本页用时319ms 总用时887ms",
    )
  })
  it("setPage/setRegions 记录当前页，导出按钮可点击不抛错", () => {
    const p = createDebugPanel(document, { classes: [] })
    document.body.appendChild(p.root)
    p.setPage(5)
    p.setRegions([
      { x1: 0, y1: 0, x2: 10, y2: 10, className: "title", conf: 0.9, behavior: "translate" },
    ])
    const btn = p.root.querySelector("button") as HTMLButtonElement
    expect(() => btn.click()).not.toThrow()
  })
  it("onFilterChange 在复选/滑杆变化时触发", () => {
    const p = createDebugPanel(document, { classes: ["title"] })
    document.body.appendChild(p.root)
    let calls = 0
    p.onFilterChange = () => {
      calls++
    }
    const cb = p.root.querySelector("input[type=checkbox]") as HTMLInputElement
    cb.click()
    const range = p.root.querySelector("input[type=range]") as HTMLInputElement
    range.value = "0.8"
    range.dispatchEvent(new Event("input"))
    expect(calls).toBe(2)
  })
})
