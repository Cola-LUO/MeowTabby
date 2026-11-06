import type { ClusterLayoutTarget } from "./modules/viewer/trans-units"
import { TextLayer } from "pdfjs-dist"
import {
  isKeepOnlyItem,
  estimateBaseLeading,
  rendersText,
  flipRegionY,
  type AssignedBlock,
} from "@/modules/pdf-core/assign/assign"
import { createDocumentFlow, type FlowUpdate } from "@/modules/pdf-core/document-flow"
import { LayoutModelRunner, type Region } from "@/modules/pdf-core/layout/model-runner"
import { blockDisplayTransform } from "@/modules/pdf-core/pdf/coords-rot"
import { loadPdf, type PDFDocumentProxy } from "@/modules/pdf-core/pdf/loader"
import { renderPageToCanvas, RENDER_SCALE } from "@/modules/pdf-core/pdf/render"
import { getTextItems, type PdfTextItem } from "@/modules/pdf-core/pdf/text-items"
import { analyzePage, type PageAnalysis } from "@/modules/pdf-core/pipeline"
import { PDF_TRANSLATE_SLOT_PARAM } from "@/utils/constants/pdf-translate"
import { i18n, initI18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { takePdfSlot } from "@/utils/pdf-slot"
import { buildPrintRoot, triggerPrint, type ExportPageData } from "./export/print-export"
import { createTranslateScheduler } from "./modules/translate/scheduler"
import { applyClusterLayout } from "./modules/viewer/apply-cluster-layout"
import {
  solveClusterLayout,
  type ClusterLayoutInput,
  type ClusterLayoutResult,
} from "./modules/viewer/cluster-layout"
import {
  createDebugPanel,
  CLASS_COLORS,
  FALLBACK_COLOR,
  type DebugPanel,
} from "./modules/viewer/debug-panel"
import { SCALE_STEPS } from "./modules/viewer/fit-text"
import { readMixedText } from "./modules/viewer/mixed-text"
import { availableHeightFor, regionToRect, type Rect } from "./modules/viewer/obstacles"
import { pageTypography } from "./modules/viewer/page-typography"
import { createPageHost, type PageHost } from "./modules/viewer/pagehost"
import { createParagraphHover } from "./modules/viewer/paragraph-hover"
import {
  renderBlocks,
  createTwoPane,
  applyTextZOrder,
  type BlockView,
} from "./modules/viewer/render-view"
import { LINE_HEIGHT } from "./modules/viewer/text-metrics"
import { buildTranslationUnits, type Unit } from "./modules/viewer/trans-units"
import "./viewer.css"
import "katex/dist/katex.min.css"

// ---------- 错误横幅：window error / unhandledrejection → 页面顶部固定横幅，无需 DevTools ----------
function installErrorBanner(): void {
  const banner = document.createElement("div")
  banner.className = "error-banner"
  document.body.appendChild(banner)
  const show = (msg: string) => {
    banner.textContent = msg
    banner.style.display = "block"
  }
  window.addEventListener("error", (e) => show(`Error: ${e.message}`))
  window.addEventListener("unhandledrejection", (e) =>
    show(`Unhandled rejection: ${String(e.reason)}`),
  )
}

/** CSS y-down 矩形与 y-down 区域的相交尺寸（用于 transBlocksOnKeep 计数）
 *  段落矩形按基线推导，边缘有 ~2px 惯性外溢；双向 ≥3px 才算实质覆盖 */
function overlapDims(
  a: { x: number; y: number; w: number; h: number },
  r: { x1: number; y1: number; x2: number; y2: number },
): { w: number; h: number } {
  const w = Math.min(a.x + a.w, r.x2) - Math.max(a.x, r.x1)
  const h = Math.min(a.y + a.h, r.y2) - Math.max(a.y, r.y1)
  return { w, h }
}

interface AcceptanceEntry {
  index: number
  cssW: number
  cssH: number
  coverage: number
  /** 原始口径 coverage（分母含 keep 消费文字），仅报告参考 */
  rawCoverage: number
  keepRegions: number
  transBlocksOnKeep: number
  /** 与 keep 区域重叠过半而被放弃翻译的段落数（模型漏检表格时的策略性放弃） */
  droppedOnKeep: number
  regionCount: number
  /** keep 区域矩形（CSS y-down，与模型输出同坐标系），供验收脚本做左右像素对比 */
  keepRects: Array<{ x1: number; y1: number; x2: number; y2: number }>
  /** 渲染后实际高超过"原位高 + 1 行"的簇数（白盒向下长出去 = 压住别人的直接证据） */
  clustersOvergrown: number
  /** 带 .trans-cluster--overflow 的簇数（估算溢出标记，仅用于统计） */
  overflowClusters: number
  /** 实测高越过"可用高"（= 障碍边界）的簇数：**结构性不变量，必须恒为 0**
   *  —— 求解器已把盒高钳在可用高内，非 0 即说明越界压住别人的路径重新出现 */
  clustersBeyondAvail: number
  /** 过滤后可见区域（CSS y-down），供验收/调试脚本离线重放归属逻辑 */
  regionRects: Array<{
    x1: number
    y1: number
    x2: number
    y2: number
    className: string
    behavior: string
  }>
}

interface PageState {
  index: number // 1-based
  left: PageHost
  right: PageHost
  overlay: HTMLElement // 调试区域叠加层（左页）
  cssW: number
  cssH: number
  rotate: number // 页面 /Rotate（0/90/180/270）
  pageWu: number // 未旋转帧页宽（MediaBox 宽）
  pageHu: number // 未旋转帧页高（MediaBox 高）
  regions: Region[] | null // 首次推理后缓存（原始 y-down，未过滤）；永不重推
  items: PdfTextItem[] | null
  textLen: number // 全部 item 文字长度和（coverage 分母）
  inferMs: number
  started: boolean
  processed: boolean
  visible: boolean
  painted: boolean
  painting: Promise<void> | null
  analysis: PageAnalysis | null
}

/** 无 url 参数的空白页（合拢计划第 2 条）：提示 + "打开 PDF"按钮。
 *  选完文件就地启动（blob URL 跨导航会失效，不能跳转）。 */
function renderOpenPdfButton(app: HTMLElement): void {
  app.classList.remove("loading")
  const wrap = document.createElement("div")
  wrap.className = "pdf-open"
  const title = document.createElement("p")
  title.className = "pdf-open__title"
  title.textContent = i18n.t("pdfTranslate.blankHintTitle")
  const hint = document.createElement("p")
  hint.className = "pdf-open__hint"
  hint.textContent = i18n.t("pdfTranslate.blankHint")
  const label = document.createElement("label")
  label.className = "pdf-open__button"
  label.textContent = i18n.t("pdfTranslate.openFile")
  const input = document.createElement("input")
  input.type = "file"
  input.accept = "application/pdf,.pdf"
  input.style.display = "none"
  input.addEventListener("change", () => {
    const file = input.files?.[0]
    if (!file) return
    void start(app, URL.createObjectURL(file), "")
  })
  label.appendChild(input)
  wrap.append(title, hint, label)
  app.replaceChildren(wrap)
}

async function main(): Promise<void> {
  installErrorBanner()
  await initI18n()
  const app = document.getElementById("app")!

  // ---------- URL 参数：?url=<pdf>&to=<目标语短码，缺省走扩展目标语设置> ----------
  // 另有 ?slot=<key>：设置页入口分页选完文件，经 IndexedDB 一次性槽位转交（blob URL 跨导航
  // 会失效，不能放进 URL 传过来，见 renderOpenPdfButton 注释）
  const params = new URLSearchParams(location.search)
  const pdfUrl = params.get("url")
  const to = params.get("to") ?? ""

  const slotKey = params.get(PDF_TRANSLATE_SLOT_PARAM)
  if (slotKey) {
    const file = await takePdfSlot(slotKey)
    if (!file) {
      console.warn(`[pdf-translate] 槽位 ${slotKey} 不存在或已消费，降级为空白引导态`)
      renderOpenPdfButton(app)
      return
    }
    await start(app, URL.createObjectURL(file), to)
    return
  }

  if (!pdfUrl) {
    renderOpenPdfButton(app)
    return
  }
  await start(app, pdfUrl, to)
}

async function start(app: HTMLElement, pdfUrl: string, to: string): Promise<void> {
  app.classList.add("loading")
  const acceptance: { pages: AcceptanceEntry[] } = { pages: [] }
  ;(window as any).__acceptance = acceptance

  // ---------- 模型 + 文档 ----------
  app.textContent = "正在加载版面模型…"
  const runner = await LayoutModelRunner.load(
    undefined,
    (loaded, total) => {
      // 进度回调已在 model-runner 内按 1s 节流
      app.textContent = total
        ? `正在加载版面模型，已加载${(loaded / 1e6).toFixed(1)}MB/共${(total / 1e6).toFixed(1)}MB...`
        : `正在加载版面模型，已加载${(loaded / 1e6).toFixed(1)}MB...`
    },
    { forceWasm: new URLSearchParams(location.search).has("wasm") },
  )
  app.textContent = "正在加载 PDF…"
  const doc: PDFDocumentProxy = await loadPdf(pdfUrl)

  // ---------- UI 骨架：debug-panel 顶栏 + two-pane（左原文 / 右 canvas 副本 + 译文层） ----------
  const panel: DebugPanel = createDebugPanel(document, { classes: runner.names })
  const panes = createTwoPane(document)
  const paneWrap = document.createElement("div")
  paneWrap.className = "two-pane"
  paneWrap.append(panes.left, panes.right)
  app.classList.remove("loading")
  app.replaceChildren(panel.root, paneWrap)

  // 按页码识别；可见范围只控制显示画布，不能改变分析和送翻顺序。
  const states: PageState[] = []
  const stateByEl = new Map<Element, PageState>()
  let queue: Promise<void> = Promise.resolve()

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    const left = createPageHost(document, vp.width, vp.height, document.createElement("canvas"))
    const right = createPageHost(document, vp.width, vp.height, document.createElement("canvas"))
    const overlay = document.createElement("div")
    overlay.className = "debug-regions"
    overlay.style.cssText = "position:absolute;inset:0;z-index:5;pointer-events:none;display:none"
    left.root.appendChild(overlay)
    panes.left.appendChild(left.root)
    panes.right.appendChild(right.root)
    const st: PageState = {
      index: i,
      left,
      right,
      overlay,
      cssW: vp.width,
      cssH: vp.height,
      regions: null,
      items: null,
      textLen: 0,
      inferMs: 0,
      rotate: (page as unknown as { rotate?: number }).rotate ?? 0,
      pageWu: 0,
      pageHu: 0,
      started: false,
      processed: false,
      visible: false,
      painted: false,
      painting: null,
      analysis: null,
    }
    states.push(st)
    stateByEl.set(left.root, st)
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const st = stateByEl.get(entry.target)
        if (!st) continue
        st.visible = entry.isIntersecting
        if (st.visible && st.processed) void paintPage(st).catch(reportError)
        else if (!st.visible && !st.painting && exporting === 0) releaseCanvas(st)
      }
    },
    { root: panes.left, rootMargin: "300px" },
  )
  for (const st of states) io.observe(st.left.root)

  function reportError(error: unknown): void {
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }
  function releaseCanvas(st: PageState): void {
    st.left.canvas.width = st.left.canvas.height = 0
    st.right.canvas.width = st.right.canvas.height = 0
    st.painted = false
  }
  function copyCanvas(st: PageState, source: HTMLCanvasElement): void {
    for (const target of [st.left.canvas, st.right.canvas]) {
      target.width = source.width
      target.height = source.height
      target.getContext("2d")!.drawImage(source, 0, 0)
      target.style.width = `${st.cssW}px`
      target.style.height = `${st.cssH}px`
    }
    st.painted = true
  }
  async function paintPage(st: PageState): Promise<void> {
    if (st.painted) return
    if (st.painting) return st.painting
    const painting = (async () => {
      const page = await doc.getPage(st.index)
      const canvas = document.createElement("canvas")
      await renderPageToCanvas(page, canvas, RENDER_SCALE)
      copyCanvas(st, canvas)
      canvas.width = canvas.height = 0
    })()
    st.painting = painting
    try {
      await painting
    } finally {
      st.painting = null
      if (!st.visible && exporting === 0) releaseCanvas(st)
    }
  }

  // ---------- 单页管线：渲染 → 副本 → 文本 → 推理（缓存）→ 过滤 → 归属 → 覆盖层 → 翻译 ----------
  async function processPage(st: PageState): Promise<void> {
    st.started = true
    try {
      const page = await doc.getPage(st.index)
      const canvas = document.createElement("canvas")
      const { width, height } = await renderPageToCanvas(page, canvas, RENDER_SCALE)
      st.cssW = width
      st.cssH = height
      st.items = await getTextItems(page)
      const textLayer = new TextLayer({
        textContentSource: await page.getTextContent(),
        container: st.left.selectLayer,
        viewport: page.getViewport({ scale: 1 }),
      })
      await textLayer.render()
      st.textLen = st.items.reduce((sum, item) => sum + item.str.length, 0)
      const t0 = performance.now()
      st.regions = await runner.predictPage(canvas, width, height)
      st.inferMs = performance.now() - t0
      if (st.visible) copyCanvas(st, canvas)
      canvas.width = canvas.height = 0
      panel.report(st.index, runner.loadMs, st.inferMs, runner.backend)
      applyPage(st)
      st.processed = true
    } catch (error) {
      throw new Error(
        `第 ${st.index} 页处理失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  const MAX_CONCURRENT_PAGES = 2
  let analysisVersion = 0
  let translationVersion = 0
  let exporting = 0
  let flow = createDocumentFlow()
  let paragraphHover = createParagraphHover()
  let flowFinished = false
  let translationJobs = new Set<Promise<void>>()
  let pdfSummary = ""
  let summaryChecked = false
  let abstractHeading: PageAnalysis["blocks"][number]["paras"][number] | undefined
  function makeTranslator() {
    const version = translationVersion
    const next = createTranslateScheduler({
      maxConcurrentPages: MAX_CONCURRENT_PAGES,
      translate: async (text) => {
        if (version !== translationVersion) throw new Error("翻译设置已更新")
        return await sendMessage("translatePdfRequest", { text, to, summary: pdfSummary })
      },
      onError: (error, text) => {
        if (version === translationVersion)
          console.warn("PDF 翻译失败，跳过该块", text.slice(0, 40), error)
      },
    })
    return next
  }
  let translator = makeTranslator()
  const pageViews = new Map<number, BlockView[]>()
  const obstacleRects = new Map<number, Rect[]>()
  const rotatedByPage = new Map<number, boolean>()

  /** 任一簇盒的可用总高（y-up）：原位高 + 到下方最近障碍的距离（向下伸展的语义，
   *  不限于合并组：普通块的长译文同样会向下长出去压人）。
   *  返回 null（页/盒/障碍表缺、旋转页）→ trans-units 退回原位高（谁都不许长高，安全侧）。 */
  function clusterAvailHeight(pageIdx: number, blockId: string, paraIdx: number): number | null {
    if (rotatedByPage.get(pageIdx)) return null
    const cluster = pageViews
      .get(pageIdx)
      ?.find((v) => v.blockId === blockId)
      ?.clusters.find((c) => c.idx.includes(paraIdx))
    const obstacles = obstacleRects.get(pageIdx)
    if (!cluster || !obstacles) return null
    // 排除自身簇盒（它当然"在自己的位置"）；其余簇盒在 obstacles 里同样是障碍
    return availableHeightFor(
      cluster.geo,
      obstacles.filter((o) => o !== cluster.geo),
    )
  }

  /** 导出目标 = 视口中央所在的页（滚动跟随），而非最近推理完成的页 */
  function currentVisiblePage(): PageState | null {
    const pane = panes.left
    const center = pane.getBoundingClientRect().top + pane.clientHeight / 2
    let best: PageState | null = null
    let bestDist = Infinity
    for (const st of states) {
      const r = st.left.root.getBoundingClientRect()
      const d = Math.abs(r.top + r.height / 2 - center)
      if (d < bestDist) {
        bestDist = d
        best = st
      }
    }
    return best
  }
  function syncExportTarget(): void {
    const best = currentVisiblePage()
    if (!best) return
    panel.setPage(best.index)
    panel.setRegions(best.regions ? panel.regionsVisible(best.regions) : [])
  }
  panes.left.addEventListener("scroll", syncExportTarget)

  // ---------- 右键菜单：四种 PDF 导出（替代浏览器对 canvas 原生的"复制图片/另存为"） ----------
  const exportMenu = document.createElement("div")
  exportMenu.className = "pdf-export-menu"
  exportMenu.style.display = "none"
  const exportToast = document.createElement("div")
  exportToast.className = "pdf-export-toast"
  exportToast.style.display = "none"
  document.body.append(exportMenu, exportToast)

  function showExportToast(msg: string): void {
    exportToast.textContent = msg
    exportToast.style.display = "block"
  }
  function hideExportToast(): void {
    exportToast.style.display = "none"
  }
  function hideExportMenu(): void {
    exportMenu.style.display = "none"
  }

  /** 构建单页/全部页的导出数据（与 print-export 解耦的最小接口） */
  function stateToExportData(st: PageState): ExportPageData {
    return {
      cssW: st.cssW,
      cssH: st.cssH,
      leftCanvas: st.left.canvas,
      rightTransLayer: st.right.transLayer,
    }
  }

  async function prepareExport(pages: PageState[], kind: "bilingual" | "translation") {
    exporting++
    try {
      for (;;) {
        await queue
        const version = analysisVersion
        await Promise.all([...translationJobs])
        if (version !== analysisVersion) continue
        for (const page of pages) await paintPage(page)
        if (version !== analysisVersion) continue
        const result = await buildPrintRoot(
          pages.map(stateToExportData),
          kind,
          pages.length === 1 ? 0 : undefined,
        )
        if (version === analysisVersion) return result
        result.root.remove()
        result.objectUrls.forEach((url) => URL.revokeObjectURL(url))
      }
    } finally {
      exporting--
      if (exporting === 0)
        for (const page of states) if (!page.visible && !page.painting) releaseCanvas(page)
    }
  }

  /** 该页导出：kind = bilingual（左原文+右译文并排）| translation（仅右栏视觉） */
  async function exportOnePage(kind: "bilingual" | "translation"): Promise<void> {
    const st = currentVisiblePage()
    if (!st || !st.processed) {
      showExportToast("该页尚未处理完成，稍后再试")
      setTimeout(hideExportToast, 3000)
      return
    }
    showExportToast("正在准备打印…")
    const { root, objectUrls, pageCssW, pageCssH } = await prepareExport([st], kind)
    const filename = `${kind === "bilingual" ? "对照翻译" : "译文"}-第${st.index}页`
    hideExportToast()
    await triggerPrint(root, filename, pageCssW, pageCssH, kind, objectUrls)
  }

  /** 全文导出：懒渲染的页先按既有串行队列补跑完整管线（已处理页复用推理缓存） */
  async function exportAllPages(kind: "bilingual" | "translation"): Promise<void> {
    showExportToast("正在准备打印（未处理页需先推理，请稍候）…")
    const { root, objectUrls, pageCssW, pageCssH } = await prepareExport(states, kind)
    const filename = `${kind === "bilingual" ? "对照翻译" : "译文"}-全文`
    hideExportToast()
    await triggerPrint(root, filename, pageCssW, pageCssH, kind, objectUrls)
  }

  // 菜单结构：复制文本（仅有选中文字时出现）│分隔线│导出该页为 PDF（双语对照/仅译文）│分隔线│导出全文为 PDF（双语对照/仅译文）
  function addMenuSeparator(): HTMLElement {
    const sep = document.createElement("div")
    sep.className = "pdf-export-menu__sep"
    exportMenu.appendChild(sep)
    return sep
  }
  function addMenuHeader(label: string): void {
    const header = document.createElement("div")
    header.className = "pdf-export-menu__header"
    header.textContent = label
    exportMenu.appendChild(header)
  }
  function addMenuItem(label: string, run: () => void, sub = false): HTMLButtonElement {
    const btn = document.createElement("button")
    btn.className = sub ? "pdf-export-menu__item pdf-export-menu__sub" : "pdf-export-menu__item"
    btn.textContent = label
    btn.addEventListener("click", () => {
      hideExportMenu()
      run()
    })
    exportMenu.appendChild(btn)
    return btn
  }

  const copyMenuItem = addMenuItem("复制文本", () => {
    const text = window.getSelection()?.toString() ?? ""
    if (text === "") return
    void navigator.clipboard.writeText(text).then(() => {
      showExportToast("已复制")
      setTimeout(hideExportToast, 2000)
    })
  })
  const copySeparator = addMenuSeparator()
  addMenuHeader("导出该页为 PDF")
  addMenuItem("双语对照", () => void exportOnePage("bilingual"), true)
  addMenuItem("仅译文", () => void exportOnePage("translation"), true)
  addMenuSeparator()
  addMenuHeader("导出全文为 PDF")
  addMenuItem("双语对照", () => void exportAllPages("bilingual"), true)
  addMenuItem("仅译文", () => void exportAllPages("translation"), true)

  app.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    // 仅有选中文字时展示"复制文本"及其下分隔线
    const hasSelection = (window.getSelection()?.toString() ?? "").trim() !== ""
    copyMenuItem.style.display = hasSelection ? "" : "none"
    copySeparator.style.display = hasSelection ? "" : "none"
    exportMenu.style.display = "flex"
    exportMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 250)}px`
    exportMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 230)}px`
  })
  window.addEventListener("click", hideExportMenu)
  window.addEventListener("blur", hideExportMenu)

  function applyPage(st: PageState): void {
    if (!st.regions || !st.items) return
    const page = analyzePage({
      index: st.index,
      cssW: st.cssW,
      cssH: st.cssH,
      rotate: st.rotate,
      items: st.items,
      regions: panel.regionsVisible(st.regions),
    })
    st.analysis = page
    if (st.index === 1 && !summaryChecked) {
      summaryChecked = true
      const paragraphs = page.order.seq.flatMap((block) => block.paras)
      const heading = paragraphs.findIndex((para) =>
        ["Abstract", "abstract", "ABSTRACT"].includes(para.text.replace(/\s/g, "")),
      )
      abstractHeading = heading >= 0 ? paragraphs[heading] : undefined
      pdfSummary = heading >= 0 ? (paragraphs[heading + 1]?.text ?? "") : ""
      if (abstractHeading) {
        const block = page.order.seq.find((candidate) => candidate.paras.includes(abstractHeading!))
        if (block) block.behavior = "skip"
      }
    }
    st.pageWu = page.pageWu
    st.pageHu = page.pageHu
    const update = flow.push(page)
    const pending = new Set(
      update.pending.filter((p) => p.pageIndex === st.index).map((p) => p.paragraph),
    )
    const rotated = st.rotate !== 0
    drawRegions(st, page.regionsDown)
    st.right.transLayer.replaceChildren()
    const views = renderBlocks(
      st.right,
      page.blocks,
      () => {},
      rotated ? (box) => blockDisplayTransform(box, st.pageWu, st.pageHu, st.rotate) : undefined,
      pending,
      undefined,
      pageTypography(
        page.blocks,
        estimateBaseLeading(
          page.items,
          page.regionsUp.filter((region) => region.className === "plain text"),
        ),
        (block) => (block.region ? estimateBaseLeading(page.items, [block.region]) : 0),
      ),
    )
    paragraphHover.install(
      st.index,
      st.left,
      st.right,
      page.blocks,
      views,
      st.pageWu,
      st.pageHu,
      st.rotate,
    )
    paragraphHover.setGroups(update.groups)
    pageViews.set(st.index, views)
    rotatedByPage.set(st.index, rotated)
    obstacleRects.set(st.index, [
      ...views.flatMap((v) => v.clusters.map((c) => c.geo)),
      ...page.keepUp.map(regionToRect),
    ])
    dispatchReady(update)
    updateAcceptance(st, page.regionsDown, page.blocks, { count: 0, len: 0 })
  }

  function dispatchReady(update: FlowUpdate): void {
    // 首成员页码决定批次；跨多页的组只有一个请求，不让后文越过它。
    const batches: (typeof update.ready)[] = []
    for (const unit of update.ready) {
      const last = batches.at(-1)
      if (last && last[0]?.parts[0]?.pageIndex === unit.parts[0]?.pageIndex) last.push(unit)
      else batches.push([unit])
    }
    const version = analysisVersion
    const scheduler = translator
    const jobs = translationJobs
    for (const batch of batches) {
      const units = buildTranslationUnits(batch, pageViews, { availHeight: clusterAvailHeight })
      const direct = new Set(
        batch.flatMap((plan, index) =>
          plan.parts.length === 1 && plan.parts[0]?.paragraph === abstractHeading ? [index] : [],
        ),
      )
      const job = fillTranslations(units, version, scheduler, direct).then(() => {
        if (version !== analysisVersion) return
        for (const page of states)
          if (page.analysis) {
            applyTextZOrder(pageViews.get(page.index) ?? [])
            collectClusterMetrics(page)
          }
      })
      jobs.add(job)
      void job.catch(reportError).finally(() => jobs.delete(job))
    }
  }
  function finishFlow(): void {
    if (flowFinished) return
    dispatchReady(flow.finish())
    flowFinished = true
  }
  function replayProcessedPages(clearTranslations: boolean): void {
    analysisVersion++
    if (clearTranslations) {
      translationVersion++
      translator = makeTranslator()
    }
    translationJobs = new Set()
    flow = createDocumentFlow()
    paragraphHover = createParagraphHover()
    flowFinished = false
    pageViews.clear()
    obstacleRects.clear()
    rotatedByPage.clear()
    for (const st of states) if (st.processed) applyPage(st)
    if (states.every((st) => st.processed)) finishFlow()
    syncExportTarget()
  }

  /** 请求按批次发起，返回可乱序；过期分析版本不回填。 */
  async function fillTranslations(
    units: Unit[],
    version: number,
    scheduler: ReturnType<typeof createTranslateScheduler>,
    direct: Set<number>,
  ): Promise<void> {
    const requests = units.map((u) => u.request)
    const { issued, pages } = await scheduler.fill(
      requests.filter((_, i) => !direct.has(i)),
      () => version === analysisVersion,
    )
    if (version !== analysisVersion) return
    if (issued > 0)
      console.info(`[translate] 并行送翻 ${issued} 条（在途批数 ${pages}/${MAX_CONCURRENT_PAGES}）`)
    // 回填 + 统一求解：普通块与合并组走同一条路径（三步：缩字号 → 拉行高 → 盒高/溢出）。
    // 合并单元的 fill 返回 splitByCapacity 给出的整组档位，作为求解起点（只允许继续降），
    // 这样"装箱"与"排版"两个阶段用同一口径，不会出现"箱子说装得下、排版说装不下"。
    const solved: { box: HTMLElement; input: ClusterLayoutInput; result: ClusterLayoutResult }[] =
      []
    units.forEach((u, i) => {
      const startScales = u.fill(direct.has(i) ? "摘要" : (scheduler.cache.get(requests[i]!) ?? ""))
      u.layoutTargets.forEach((t, k) => {
        // 可用高落成 data 属性：验收要核"盒高是否越过障碍边界"这个结构性不变量
        t.box.dataset.availHeight = String(t.availHeight)
        const input = layoutInputOf(t, Array.isArray(startScales) ? startScales[k] : undefined)
        solved.push({ box: t.box, input, result: solveClusterLayout(input) })
      })
    })
    for (const s of solved) applyClusterLayout(s.box, s.result)
    refitOverflowingUnits(units)
  }

  /** 求解输入：几何来自 target（renderBlocks 建盒时的原位几何），文本取盒内已回填的内容。
   *  文本必须用 readMixedText 读（而不是 textContent）：段间的 `<br>` 不产生文本，textContent
   *  会把多段拼成一条，行数被低估 → 阶段 2 按低估的行数把行高拉得更大 → 真实内容溢出，
   *  而阶段 3 仍按低估值判"装得下" → 被 overflow:hidden 静默裁掉。 */
  function layoutInputOf(t: ClusterLayoutTarget, startScale?: number): ClusterLayoutInput {
    return {
      text: readMixedText(t.box),
      width: t.width,
      minHeight: t.minHeight,
      availHeight: t.availHeight,
      baseFontSize: t.baseFontSize,
      lineHeight: t.lineHeight,
      startScale,
    }
  }

  /** 单元的全部白盒：合并组以 part 白盒为准（与原行为一致），其余单元用求解目标里的盒。 */
  function unitBoxes(u: Unit): HTMLElement[] {
    return u.groupBoxes ? u.groupBoxes.map((b) => b.box) : u.layoutTargets.map((t) => t.box)
  }

  /** 实测溢出（+2px 容差吸收次像素取整）：判据只能是 scrollHeight —— 盒高已被求解器写死
   *  （applyClusterLayout 写 height），offsetHeight 恒等于 height，拿它判会变成永远为假的死代码。 */
  function overflowingBoxes(u: Unit): HTMLElement[] {
    return unitBoxes(u).filter((b) => b.scrollHeight > b.clientHeight + 2)
  }

  /** 盒的当前档位：DOM 实际字号 ÷ 建盒基准字号（两者分别由 applyClusterLayout / renderBlocks 写入）。 */
  function currentScale(box: HTMLElement): number {
    const base = Number.parseFloat(box.dataset.baseFontSize ?? "")
    const fs = Number.parseFloat(box.style.fontSize)
    return Number.isFinite(base) && base > 0 && Number.isFinite(fs) ? fs / base : 1
  }

  const lhRound = (v: number): number => Math.round(v * 10) / 10

  /** 排完实测复核：分配与求解用的都是**估算**（jsdom 无布局、真机字体也有差），回填后按 DOM 实测
   *  复核"内容是否真的超出了盒"。按**代价从小到大**分两阶段修：
   *
   *  **阶段 A · 只降行高（字号不动）**：行高是**连续量**、字号是**离散档位**（一跳就 10%）。
   *  "估算比真实少算一行"这类小误差，用降行高吸收代价最小 —— 字号仍与原文一致，盒内也不留大片空白。
   *  **阶段 B · 行高降到底仍溢出，才缩字号**：此时行高锁在底线，否则阶段 2 会按"填满原位高"
   *  把刚缩下去的内容又填回来（字号小了、行高更大，内容反而不降），等于白缩。
   *
   *  **盒高不动（不补框）**：盒高恒为求解结果，两阶段都失败时裁切超出框的内容，绝不向外长。
   *  降到下限仍超则告警，保留白底。
   *  jsdom 下 scrollHeight/clientHeight 恒 0 → 天然跳过，不污染单测。 */
  function refitOverflowingUnits(units: Unit[]): void {
    const LH_STEP_DOWN = 0.1
    for (const u of units) {
      let bad = overflowingBoxes(u)
      if (bad.length === 0) continue
      // 阶段 A：只降行高（档位锁定在当前值，禁止阶段 1 顺手缩字号）
      const startLh = Math.max(
        ...bad.map((b) => Number.parseFloat(b.style.lineHeight) || LINE_HEIGHT),
      )
      let fixed = false
      for (
        let lh = lhRound(startLh - LH_STEP_DOWN);
        lh >= LINE_HEIGHT - 1e-6;
        lh = lhRound(lh - LH_STEP_DOWN)
      ) {
        bad.forEach((b) => {
          const t = u.layoutTargets.find((x) => x.box === b)
          if (!t) return
          const s = currentScale(b)
          applyClusterLayout(
            b,
            solveClusterLayout({ ...layoutInputOf(t, s), lineHeight: lh, scales: [s] }),
          )
        })
        bad = overflowingBoxes(u)
        if (bad.length === 0) {
          fixed = true
          break
        }
      }
      if (fixed) continue

      // 阶段 B：行高已到底仍溢出 → 缩字号（行高锁在底线）
      for (const scale of SCALE_STEPS) {
        if (scale >= 1) continue
        // 合并组：按新档位重新分配容量并重填；其余单元的内容分配与档位无关，无需重填
        u.refit?.(scale)
        u.layoutTargets.forEach((t) =>
          applyClusterLayout(
            t.box,
            solveClusterLayout({ ...layoutInputOf(t, scale), lineHeight: LINE_HEIGHT }),
          ),
        )
        if (overflowingBoxes(u).length === 0) {
          fixed = true
          break
        }
      }
      if (!fixed) {
        console.warn(
          "[render] 降字号到下限仍有盒内容溢出（超出框的内容已裁切）：" +
            `可用高 ${Math.round(u.layoutTargets[0]?.availHeight ?? 0)}px，${bad.length} 个白盒`,
        )
      }
    }
  }

  function drawRegions(st: PageState, regions: Region[]): void {
    st.overlay.replaceChildren()
    for (const r of regions) {
      const color = CLASS_COLORS[r.className] ?? FALLBACK_COLOR
      const box = document.createElement("div")
      box.style.cssText =
        `position:absolute;left:${r.x1}px;top:${r.y1}px;width:${r.x2 - r.x1}px;height:${r.y2 - r.y1}px;` +
        `border:1px solid ${color};background:${color}22`
      box.title = `${r.className} ${(r.conf * 100).toFixed(0)}%`
      st.overlay.appendChild(box)
    }
  }

  function updateAcceptance(
    st: PageState,
    visible: Region[],
    blocks: AssignedBlock[],
    droppedOnKeep: { count: number; len: number },
  ): void {
    const paras = blocks.flatMap((b) => (rendersText(b) ? b.paras : []))
    const translatedLen = paras.reduce((s, p) => s + p.text.length, 0)
    const keep = visible.filter((r) => r.behavior === "keep")
    let onKeep = 0
    for (const p of paras) {
      // 段落矩形转 CSS y-down 后与 keep 区域（原始 y-down）做重叠判定
      const rect = { x: p.x, y: st.cssH - (p.y + p.h), w: p.w, h: p.h }
      if (
        keep.some((r) => {
          const d = overlapDims(rect, r)
          return d.w >= 3 && d.h >= 3
        })
      )
        onKeep++
    }
    // coverage 分母剔除"仅被 keep 区域消费"的文字：这类文字按设计保留原文（Task 9 实测：
    // 矢量表格/架构图的内部文字可占整页 30%+，计入分母会让正确行为永远达不到 0.98）
    const keepOnlyLen = (st.items ?? []).reduce(
      (s, it) =>
        s +
        (isKeepOnlyItem(
          it,
          visible.map((r) => flipRegionY(r, st.cssH)),
        )
          ? it.str.length
          : 0),
      0,
    )
    const translatableLen = st.textLen - keepOnlyLen - droppedOnKeep.len
    acceptance.pages[st.index - 1] = {
      index: st.index,
      cssW: st.cssW,
      cssH: st.cssH,
      coverage: translatableLen > 0 ? translatedLen / translatableLen : 0,
      rawCoverage: st.textLen > 0 ? translatedLen / st.textLen : 0,
      keepRegions: keep.length,
      transBlocksOnKeep: onKeep,
      droppedOnKeep: droppedOnKeep.count,
      regionCount: visible.length,
      keepRects: keep.map((r) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 })),
      regionRects: visible.map((r) => ({
        x1: r.x1,
        y1: r.y1,
        x2: r.x2,
        y2: r.y2,
        className: r.className,
        behavior: r.behavior,
      })),
      clustersOvergrown: 0,
      overflowClusters: 0,
      clustersBeyondAvail: 0,
    }
  }

  /** 渲染后簇盒实测采集（DOM 口径）。必须在**回填之后**调用——盒高与溢出类都由回填阶段的排版写。
   *  "向下长"的判据：实测高 > 原位高 + 1 行（行高 = 字号 × 1.3，与 CSS 同口径），再放 1px 取整容差。
   *  jsdom 下 offsetHeight 恒 0 → 两类计数天然为 0，不污染单测。 */
  function collectClusterMetrics(st: PageState): void {
    const entry = acceptance.pages[st.index - 1]
    if (!entry) return
    let grown = 0
    let overflow = 0
    let beyond = 0
    for (const cl of st.right.transLayer.querySelectorAll<HTMLElement>(".trans-cluster")) {
      if (cl.classList.contains("trans-cluster--overflow")) overflow++
      const minH = parseFloat(cl.dataset.minHeight ?? "")
      const fs = parseFloat(cl.dataset.baseFontSize ?? "")
      if (Number.isFinite(minH) && Number.isFinite(fs) && cl.offsetHeight > minH + fs * 1.3 + 1)
        grown++
      const availH = parseFloat(cl.dataset.availHeight ?? "")
      if (Number.isFinite(availH) && cl.offsetHeight > availH + 1) beyond++
    }
    entry.clustersOvergrown = grown
    entry.overflowClusters = overflow
    entry.clustersBeyondAvail = beyond
  }

  // 重放只复用已缓存的识别输入，两个入口仍执行相同的 D 流程。
  panel.onFilterChange = () => replayProcessedPages(false)
  panel.onBoxesVisibilityChange = (visible) => {
    for (const st of states) st.overlay.style.display = visible ? "" : "none"
  }

  // ---------- 刷新翻译：设置有变化才重翻；分块（推理/归属）结果一律复用 ----------
  // 基准快照 = 翻译启动时的设置，此后每次点击与它比较：
  //   变了 → 清译文缓存 + 重放已处理页（regions/items 已缓存，绝不重推理；
  //          尚未处理的页由懒渲染队列自然继续算完，自动用新设置）；
  //   没变 → 点击无效，不执行任何操作。
  const refreshBtn = document.createElement("button")
  refreshBtn.className = "btn refresh-toggle"
  refreshBtn.textContent = "刷新翻译"
  document.body.appendChild(refreshBtn)
  // 设置快照只是刷新按钮的基准，不能阻塞文档分析启动。
  queue = (async () => {
    for (const st of states) await processPage(st)
    finishFlow()
  })()
  void queue.catch(reportError)
  let settingsSnapshot: string | null = null
  try {
    settingsSnapshot = await sendMessage("getPdfTranslationSettings")
  } catch {
    // background 未就绪等异常：留 null，首次点击成功拉取时只立基准、不重翻
  }
  refreshBtn.addEventListener("click", () => {
    void (async () => {
      let current: string
      try {
        current = await sendMessage("getPdfTranslationSettings")
      } catch {
        return
      }
      if (settingsSnapshot === null) {
        settingsSnapshot = current
        return
      }
      if (current === settingsSnapshot) return
      settingsSnapshot = current
      replayProcessedPages(true)
      showExportToast("检测到设置变化，正在重新翻译…")
      setTimeout(hideExportToast, 3000)
    })()
  })
}

void main()
