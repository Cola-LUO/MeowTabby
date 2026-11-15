/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest"
import { mountSettingsToolbar } from "../settings-toolbar"

function pressOn(target: Element): void {
  target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }))
}

function makeButtons(): [HTMLButtonElement, HTMLButtonElement] {
  const adv = document.createElement("button")
  adv.className = "btn adv-toggle"
  const refresh = document.createElement("button")
  refresh.className = "btn refresh-toggle"
  document.body.append(adv, refresh)
  return [adv, refresh]
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("PDF 翻译页设置工具条", () => {
  it("折叠时只显示设置图标；点图标在右侧展开两个入口", () => {
    const [adv, refresh] = makeButtons()
    mountSettingsToolbar(document)

    const icon = document.querySelector<HTMLButtonElement>(".pdf-settings-toggle")!
    const menu = document.querySelector<HTMLElement>(".pdf-settings-menu")!
    expect(menu.hidden).toBe(true)
    expect(menu.contains(adv)).toBe(true)
    expect(menu.contains(refresh)).toBe(true)
    expect(menu.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()

    icon.click()
    expect(menu.hidden).toBe(false)
  })

  it("点设置图标、两个入口或其内部时保持展开；再点图标收回", () => {
    const [adv] = makeButtons()
    const child = document.createElement("span")
    adv.append(child)
    const refresh = document.querySelector<HTMLButtonElement>(".refresh-toggle")!
    mountSettingsToolbar(document)

    const icon = document.querySelector<HTMLButtonElement>(".pdf-settings-toggle")!
    const menu = document.querySelector<HTMLElement>(".pdf-settings-menu")!
    icon.click()
    pressOn(icon)
    pressOn(adv)
    pressOn(child)
    pressOn(refresh)
    expect(menu.hidden).toBe(false)

    icon.click()
    expect(menu.hidden).toBe(true)
  })

  it("点任一入口后收回，入口自身的点击逻辑照旧执行", () => {
    const [adv, refresh] = makeButtons()
    let clicked = 0
    adv.addEventListener("click", () => clicked++)
    mountSettingsToolbar(document)

    const icon = document.querySelector<HTMLButtonElement>(".pdf-settings-toggle")!
    const menu = document.querySelector<HTMLElement>(".pdf-settings-menu")!
    icon.click()
    expect(menu.hidden).toBe(false)
    adv.click()
    expect(clicked).toBe(1)
    expect(menu.hidden).toBe(true)

    icon.click()
    refresh.click()
    expect(menu.hidden).toBe(true)
  })

  it("点图标与两个入口之外的区域收回", () => {
    const outside = document.createElement("main")
    document.body.append(outside)
    makeButtons()
    mountSettingsToolbar(document)

    const icon = document.querySelector<HTMLButtonElement>(".pdf-settings-toggle")!
    const menu = document.querySelector<HTMLElement>(".pdf-settings-menu")!
    icon.click()
    expect(menu.hidden).toBe(false)

    pressOn(outside)
    expect(menu.hidden).toBe(true)
  })

  it("不碰两个入口自身的显示属性，面板的 CSS 隐藏规则照旧生效", () => {
    const [adv, refresh] = makeButtons()
    mountSettingsToolbar(document)

    // 折叠只动菜单的 hidden，不写按钮的 inline style；
    // debug-panel 仍靠 advBtn.style.display 与 body.pdf-debug-open 控制显隐。
    expect(adv.style.display).toBe("")
    expect(refresh.style.display).toBe("")
    document.body.classList.add("pdf-debug-open")
    expect(document.body.classList.contains("pdf-debug-open")).toBe(true)
    expect(adv.style.display).toBe("")
    expect(refresh.style.display).toBe("")
    document.body.classList.remove("pdf-debug-open")
  })
})
