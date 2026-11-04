import type { Region } from "@/modules/pdf-core/layout/model-runner"

export interface DebugPanel {
  root: HTMLElement
  onBoxesVisibilityChange: ((visible: boolean) => void) | null
  regionsVisible(regions: Region[]): Region[]
  report(page: number, loadMs: number, inferMs: number, backend: string): void
  exportJson(page: number, regions: Region[]): void
  /** main 在每页应用后调用：记录"当前页"，导出按钮据此导出 */
  setPage(page: number): void
  setRegions(regions: Region[]): void
  /** 过滤条件（复选/滑杆）变化时通知 main 重渲染各页 */
  onFilterChange: (() => void) | null
}

/** 类别配色：必须覆盖 MODEL_CLASSES（`src/modules/layout/decode.ts`）全部类别——
 *  缺一类就会落到 FALLBACK_COLOR，看起来像"这个框没分类"（2026-09-14：table_footnote / formula_caption 就是这样漏的）。
 *  单测 `src/modules/layout/__tests__/class-tables.test.ts` 会校验覆盖。 */
export const CLASS_COLORS: Record<string, string> = {
  title: "#e6b800",
  "plain text": "#4caf50",
  abandon: "#9e9e9e",
  figure: "#2196f3",
  figure_caption: "#9c27b0",
  table: "#ff5722",
  table_caption: "#ff9800",
  table_footnote: "#8d6e63",
  isolate_formula: "#9c27b0",
  formula_caption: "#00bcd4",
}
/** 未登记类别的兜底色（叠加层框线与顶栏类别标签共用）：一眼看出"这类还没收录" */
export const FALLBACK_COLOR = "#ff5252"

export function createDebugPanel(doc: Document, opts: { classes: string[] }): DebugPanel {
  const root = doc.createElement("div")
  root.className = "debug-panel" // 默认隐藏（viewer.css），加 .open 才浮出
  // 默认 0.25（用户口径 20~30%）：0.5 会把 0.35~0.5 置信度的正文区域整块滤掉，
  // 表现为"译文不出来，动一下滑杆才出来"（2026-09-18 用户报告）
  const conf = { threshold: 0.25, enabled: new Set(opts.classes) }
  const exportState: { page: number; regions: Region[] } = { page: -1, regions: [] }

  // 三行布局容器
  const row1 = doc.createElement("div")
  row1.className = "dbg-row dbg-row1"
  const row2 = doc.createElement("div")
  row2.className = "dbg-row dbg-row2"
  const row3 = doc.createElement("div")
  row3.className = "dbg-row dbg-row3"

  // 第一行：各类别色块名称
  for (const cls of opts.classes) {
    const label = doc.createElement("label")
    label.style.color = CLASS_COLORS[cls] ?? FALLBACK_COLOR
    const cb = doc.createElement("input")
    cb.type = "checkbox"
    cb.checked = true
    cb.addEventListener("change", () => {
      if (cb.checked) conf.enabled.add(cls)
      else conf.enabled.delete(cls)
      panel.onFilterChange?.()
    })
    label.append(cb, doc.createTextNode(cls))
    row1.appendChild(label)
  }

  // 第二行：置信度说明 + 滑杆（同行）
  const confLabel = doc.createElement("span")
  confLabel.className = "conf-label"
  confLabel.textContent = "置信度调节（左滑判定条件更松，右滑逐渐不判定）"
  row2.appendChild(confLabel)
  const range = doc.createElement("input")
  range.type = "range"
  range.min = "0"
  range.max = "1"
  range.step = "0.05"
  range.value = "0.25"
  // --val（0~1）：交给 CSS 画"已填充(左)/未填充(右)"的分界；原生 range 无法用 CSS 指定未填充轨道色
  range.style.setProperty("--val", range.value)
  range.addEventListener("input", () => {
    range.style.setProperty("--val", range.value)
    conf.threshold = Number(range.value)
    panel.onFilterChange?.()
  })
  row2.appendChild(range)

  const boxesLabel = doc.createElement("label")
  const boxes = doc.createElement("input")
  boxes.type = "checkbox"
  boxes.checked = false
  boxes.addEventListener("change", () => panel.onBoxesVisibilityChange?.(boxes.checked))
  boxesLabel.append(boxes, doc.createTextNode("显示左页检测框"))
  row2.appendChild(boxesLabel)

  // 第三行：性能区 + 导出 + 收起
  const perf = doc.createElement("span")
  perf.className = "perf"
  row3.appendChild(perf)
  const btn = doc.createElement("button")
  btn.className = "btn"
  btn.textContent = "导出本页JSON"
  row3.appendChild(btn)
  const closeBtn = doc.createElement("button")
  closeBtn.className = "btn"
  closeBtn.textContent = "收起"
  row3.appendChild(closeBtn)

  root.append(row1, row2, row3)

  // 左上角"高级选项"入口：默认只显示它，点开才浮出调试面板
  const advBtn = doc.createElement("button")
  advBtn.className = "btn adv-toggle"
  advBtn.textContent = "高级选项"
  doc.body.appendChild(advBtn)

  function openPanel(): void {
    root.classList.add("open")
    advBtn.style.display = "none"
    // 通知 CSS 隐藏左上角其他常驻入口（刷新翻译），给面板让位
    doc.body.classList.add("pdf-debug-open")
  }
  function closePanel(): void {
    root.classList.remove("open")
    advBtn.style.display = ""
    doc.body.classList.remove("pdf-debug-open")
  }
  advBtn.addEventListener("click", openPanel)
  closeBtn.addEventListener("click", closePanel)

  const panel: DebugPanel = {
    root,
    onFilterChange: null,
    onBoxesVisibilityChange: null,
    regionsVisible(regions) {
      return regions.filter((r) => conf.enabled.has(r.className) && r.conf >= conf.threshold)
    },
    report(page, loadMs, inferMs, backend) {
      perf.textContent = `当前已推理至第${page}页 推理${Math.round(inferMs)}ms 后端${backend} 模型加载${Math.round(loadMs)}ms`
    },
    exportJson(page, regions) {
      const json = JSON.stringify({ page, regions }, null, 2)
      console.info("[debug-panel] 导出当前页区域", json)
      void navigator.clipboard?.writeText(json)
    },
    setPage(page) {
      exportState.page = page
    },
    setRegions(regions) {
      exportState.regions = regions
    },
  }
  btn.addEventListener("click", () => panel.exportJson(exportState.page, exportState.regions))
  return panel
}
