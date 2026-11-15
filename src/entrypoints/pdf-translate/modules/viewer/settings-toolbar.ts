/** 左上角设置入口：把页面上已存在的「高级选项」「刷新翻译」收进一个滑块图标，
 *  点图标展开、点外面收回。只搬 DOM 节点，不改两个按钮自身的显示与点击逻辑。 */
const SLIDER_LINES: readonly (readonly [number, number, number, number])[] = [
  [3, 5, 10, 5],
  [3, 12, 8, 12],
  [3, 19, 12, 19],
  [8, 3, 8, 7],
  [14, 10, 14, 14],
  [16, 17, 16, 21],
  [14, 7, 21, 7],
  [14, 14, 21, 14],
  [16, 21, 21, 21],
]

function createToggle(doc: Document): HTMLButtonElement {
  const btn = doc.createElement("button")
  btn.className = "pdf-settings-toggle"
  btn.type = "button"
  btn.title = "设置"
  btn.setAttribute("aria-label", "设置")
  btn.setAttribute("aria-expanded", "false")
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("width", "20")
  svg.setAttribute("height", "20")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "2")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")
  for (const [x1, y1, x2, y2] of SLIDER_LINES) {
    const line = doc.createElementNS("http://www.w3.org/2000/svg", "line")
    line.setAttribute("x1", String(x1))
    line.setAttribute("y1", String(y1))
    line.setAttribute("x2", String(x2))
    line.setAttribute("y2", String(y2))
    svg.appendChild(line)
  }
  btn.appendChild(svg)
  return btn
}

export function mountSettingsToolbar(doc: Document): void {
  const adv = doc.body.querySelector<HTMLElement>(".adv-toggle")
  const refresh = doc.body.querySelector<HTMLElement>(".refresh-toggle")
  if (adv === null || refresh === null) return

  const bar = doc.createElement("div")
  bar.className = "pdf-settings-toolbar"
  const toggle = createToggle(doc)
  const menu = doc.createElement("div")
  menu.className = "pdf-settings-menu"
  menu.hidden = true
  // 移动已有节点：事件监听仍绑在原节点上，两个按钮的既有逻辑不变
  menu.append(adv, refresh)
  bar.append(toggle, menu)
  doc.body.appendChild(bar)

  let expanded = false
  function setExpanded(value: boolean): void {
    expanded = value
    menu.hidden = !value
    toggle.setAttribute("aria-expanded", String(value))
  }
  toggle.addEventListener("click", () => setExpanded(!expanded))
  // 点任一入口后收回（两个入口各自的点击逻辑仍由原监听器执行）
  menu.addEventListener("click", () => setExpanded(false))
  // 捕获阶段监听：点两个入口本身时它们已进入菜单，不算「外面」
  doc.addEventListener(
    "pointerdown",
    (e) => {
      if (expanded && e.target instanceof Node && !bar.contains(e.target)) setExpanded(false)
    },
    true,
  )
}
