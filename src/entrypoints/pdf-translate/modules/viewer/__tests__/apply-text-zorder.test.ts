/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { applyTextZOrder, fillBlockText, type BlockView } from "../render-view"

function makeViews(...lens: number[]): BlockView[] {
  return lens.map((len, i) => {
    const el = document.createElement("div")
    el.textContent = "x".repeat(len)
    return { blockId: `b${i}`, paras: [], el, clusters: [], noSegment: false }
  })
}

describe("applyTextZOrder", () => {
  it("文字越多的块 z-index 越高，空块最低", () => {
    const views = makeViews(5, 50, 0)
    applyTextZOrder(views)
    const z = views.map((v) => Number(v.el.style.zIndex))
    expect(z[1]!).toBeGreaterThan(z[0]!) // 50 字 > 5 字
    expect(z[0]!).toBeGreaterThan(z[2]!) // 5 字 > 空块
    expect(z[2]!).toBe(1) // 空块沉底
  })
  it("等长块按稳定顺序给相邻 z（规则只约束长短，等长无遮挡要求）", () => {
    const views = makeViews(10, 10)
    applyTextZOrder(views)
    const z = views.map((v) => Number(v.el.style.zIndex))
    expect(Math.abs(z[0]! - z[1]!)).toBe(1)
  })
  it("重复调用（重渲染）后 z 仍正确", () => {
    const views = makeViews(3, 30)
    applyTextZOrder(views)
    applyTextZOrder(views)
    expect(Number(views[1]!.el.style.zIndex)).toBeGreaterThan(Number(views[0]!.el.style.zIndex))
  })
})

describe("fillBlockText：块内段落用 <br> 分隔", () => {
  it("多段之间插 <br>，段内文本原样", () => {
    const el = document.createElement("div")
    fillBlockText(el, ["第一段", "第二段", "第三段"])
    expect(el.children).toHaveLength(2)
    expect([...el.children].every((c) => c.tagName === "BR")).toBe(true)
    expect(el.textContent).toBe("第一段第二段第三段")
  })

  it("单段不加 <br>", () => {
    const el = document.createElement("div")
    fillBlockText(el, ["only one"])
    expect(el.children).toHaveLength(0)
    expect(el.textContent).toBe("only one")
  })

  it("重复填充替换旧内容（重渲染不叠加）", () => {
    const el = document.createElement("div")
    fillBlockText(el, ["old1", "old2"])
    fillBlockText(el, ["new"])
    expect(el.children).toHaveLength(0)
    expect(el.textContent).toBe("new")
  })

  it("模型返回的 HTML 按纯文本处理（不用 innerHTML，无注入面）", () => {
    const el = document.createElement("div")
    fillBlockText(el, ["<img src=x onerror=alert(1)>"])
    expect(el.querySelector("img")).toBeNull()
    expect(el.textContent).toBe("<img src=x onerror=alert(1)>")
  })
})
