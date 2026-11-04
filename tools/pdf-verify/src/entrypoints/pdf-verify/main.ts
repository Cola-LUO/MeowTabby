import type { AssignedBlock } from "../../../../../src/modules/pdf-core/assign/assign"
import type { PairDecision } from "../../../../../src/modules/pdf-core/assign/cross-merge"
import { requestTextForUnit } from "../../../../../src/entrypoints/pdf-translate/modules/translate/segment-utils"
import {
  createDocumentFlow,
  type FlowUpdate,
} from "../../../../../src/modules/pdf-core/document-flow"
import { extUrl } from "../../../../../src/modules/pdf-core/env"
import { LayoutModelRunner } from "../../../../../src/modules/pdf-core/layout/model-runner"
import { blockDisplayTransform } from "../../../../../src/modules/pdf-core/pdf/coords-rot"
import { loadPdf, type PDFDocumentProxy } from "../../../../../src/modules/pdf-core/pdf/loader"
import { renderPageToCanvas, RENDER_SCALE } from "../../../../../src/modules/pdf-core/pdf/render"
import { getTextItems } from "../../../../../src/modules/pdf-core/pdf/text-items"
import { analyzePage, type PageAnalysis } from "../../../../../src/modules/pdf-core/pipeline"
import {
  chooseSliceDirectory,
  hasSliceDirectory,
  readSlicePage,
  restoreSliceDirectory,
  sliceKey,
  writeSlicePage,
} from "../../slice-cache"
import "./viewer.css"

const CLASS_COLORS: Record<string, string> = {
  title: "#f59e0b",
  "plain text": "#3b82f6",
  abandon: "#6b7280",
  figure: "#10b981",
  figure_caption: "#34d399",
  table: "#8b5cf6",
  table_caption: "#a78bfa",
  table_footnote: "#c4b5fd",
  isolate_formula: "#ec4899",
  formula_caption: "#f472b6",
}
const FALLBACK_COLOR = "#ef4444"

const GROUP_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
]
const groupColor = (gid: number) => GROUP_COLORS[gid % GROUP_COLORS.length]!

/** 检测框来源：repaired = 补框后（横向吸收 + 重叠合并）；raw = YOLO 原框 */
type BoxMode = "repaired" | "raw"
let boxMode: BoxMode = "repaired"
let showParagraphBoxes = false

interface PageResult extends PageAnalysis {
  lineOrderTexts: string[][]
  groupHits: Map<number, Array<{ block: AssignedBlock; paraIdx: number }>>
  numbers: Map<AssignedBlock, number>
  overlay: HTMLDivElement
}

/** 全局同段组：gid → 组成员引用（组可跨页） */
const crossPageGroups = new Map<number, GroupRef[]>()
/** 右栏条目：成功 = 整张同段组卡片（含成员摘抄 + 组内每次合并得分），失败 = 单条配对行。
 *  两者按阅读序（decisions 的判定顺序）交替排列，不再分区块展示。 */
type PanelEntry =
  | { kind: "group"; gid: number; refs: GroupRef[]; decisions: PairDecision[] }
  | { kind: "failed"; decision: PairDecision }
let panelEntries: PanelEntry[] = []
/** 最近一次重算的计数（头部汇总用） */
let panelStats = { merged: 0, failed: 0, sameColumn: 0 }

/** 组内成员引用（页 + 块 id + 段序 + 文本），右栏组成员行用 */
interface GroupRef {
  pageIndex: number
  blockId: string
  paraIdx: number
  text: string
}

let runner: LayoutModelRunner | null = null
let doc: PDFDocumentProxy | null = null
let pageResults: PageResult[] = []
/** 本次验证的界面引用。 */
let statusEl: HTMLSpanElement | null = null
let rightPaneEl: HTMLElement | null = null

const app = document.getElementById("app")!

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

async function main(): Promise<void> {
  installErrorBanner()
  installDropTarget()
  try {
    await restoreSliceDirectory()
  } catch (error) {
    console.warn("[slice] 恢复切片目录失败", error)
  }
  renderFilePicker()
}

let sliceMode = false

function renderFilePicker(): void {
  const wrap = document.createElement("div")
  wrap.className = "file-picker"
  const hint = document.createElement("p")
  hint.textContent = "选择一个 PDF 开始验证（版面识别 + 同栏段分组 + 跨栏/跨页同段配对）"
  const hint2 = document.createElement("p")
  hint2.className = "hint2"
  hint2.textContent = "也可以把 PDF 文件直接拖进本窗口"
  const label = document.createElement("label")
  label.className = "file-btn"
  label.textContent = "选择 PDF"
  const input = document.createElement("input")
  input.type = "file"
  input.accept = "application/pdf,.pdf"
  input.style.display = "none"
  input.addEventListener("change", () => {
    const file = input.files?.[0]
    if (!file) return
    void startVerification(file)
  })
  label.appendChild(input)
  const sliceLabel = document.createElement("label")
  sliceLabel.className = "slice-option"
  const sliceInput = document.createElement("input")
  sliceInput.type = "checkbox"
  sliceInput.checked = sliceMode
  const sliceStatus = document.createElement("span")
  sliceStatus.className = "slice-status"
  sliceStatus.textContent = hasSliceDirectory()
    ? "已连接项目切片目录"
    : "启用后请选择 MeowTabby/tools/pdf-verify/slices 文件夹"
  sliceInput.addEventListener("change", async () => {
    if (!sliceInput.checked) {
      sliceMode = false
      return
    }
    try {
      if (!hasSliceDirectory()) await chooseSliceDirectory()
      sliceMode = true
      sliceStatus.textContent = "已连接项目切片目录"
    } catch (error) {
      sliceInput.checked = false
      sliceMode = false
      if (!(error instanceof DOMException && error.name === "AbortError"))
        sliceStatus.textContent = error instanceof Error ? error.message : String(error)
    }
  })
  sliceLabel.append(sliceInput, " 切片测试：首次保存 YOLO 结果，之后选同一 PDF 直接复用")
  wrap.append(hint, hint2, sliceLabel, sliceStatus, label)
  app.replaceChildren(wrap)
}

/** 整页拖拽：拖入 PDF 文件即开始验证（文件选择框无法指定初始目录，拖拽是最省事的替代） */
function installDropTarget(): void {
  document.addEventListener("dragover", (e) => {
    e.preventDefault()
  })
  document.addEventListener("drop", (e) => {
    e.preventDefault()
    if (starting) return
    const file = Array.from(e.dataTransfer?.files ?? []).find(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name),
    )
    if (file) void startVerification(file)
  })
}

/** 防重入：处理中忽略新的文件/拖拽 */
let starting = false

async function startVerification(file: File): Promise<void> {
  if (starting) return
  if (sliceMode && !hasSliceDirectory()) {
    const status = app.querySelector(".slice-status")
    if (status) status.textContent = "请先选择 MeowTabby/tools/pdf-verify/slices 文件夹"
    return
  }
  starting = true
  try {
    await runVerify(file)
  } finally {
    starting = false
  }
}

async function runVerify(file: File): Promise<void> {
  app.classList.add("loading")
  app.textContent = sliceMode ? "正在查找切片…" : "正在加载 PDF…"
  const pdfKey = sliceMode ? await sliceKey(file) : null
  const url = URL.createObjectURL(file)
  try {
    doc = await loadPdf(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  pageResults = []
  crossPageGroups.clear()

  const layout = buildLayout()
  app.classList.remove("loading")
  app.replaceChildren(layout.toolbar, layout.panes)
  // 进度字挂独立 span：绝不能赋 app.textContent（会清空整个布局——黑屏 bug 的根源）
  const status = document.createElement("span")
  status.className = "toolbar-status"
  layout.toolbar.appendChild(status)
  const compare = document.createElement("div")
  compare.className = "toolbar-compare"
  layout.toolbar.appendChild(compare)
  const mismatches: Array<{
    label: string
    card: HTMLElement
    part: FlowUpdate["ready"][number]["parts"][number]
  }> = []
  const updateCompare = () => {
    compare.replaceChildren("文本不一致：")
    if (!mismatches.length) compare.append("无")
    mismatches.forEach(({ label, card, part }, index) => {
      if (index) compare.append("、")
      const button = document.createElement("button")
      button.className = "compare-link"
      button.textContent = label
      button.addEventListener("click", () => {
        requestPane
          .querySelector(".request-card--selected")
          ?.classList.remove("request-card--selected")
        card.classList.add("request-card--selected")
        card.scrollIntoView({ block: "center" })
        const result = pageResults[part.pageIndex - 1]
        if (!result) return
        for (const old of layout.leftPane.querySelectorAll(".compare-target")) old.remove()
        const marker = document.createElement("div")
        marker.className = "compare-target"
        marker.style.cssText = displayBox(result, part.paragraph)
        result.overlay.appendChild(marker)
        marker.scrollIntoView({ block: "center", inline: "center" })
      })
      compare.appendChild(button)
    })
  }
  updateCompare()
  statusEl = status
  rightPaneEl = layout.rightPane
  const requestPane = layout.middlePane
  const flow = createDocumentFlow()
  let reusedPages = 0
  let recordedPages = 0
  for (let i = 1; i <= doc.numPages; i++) {
    status.textContent = `正在处理第 ${i}/${doc.numPages} 页…`
    try {
      const result = await processOnePage(i, pdfKey, (reused) => {
        if (reused) reusedPages++
        else recordedPages++
      })
      // 先让共用顺序状态验收，排序不完整或失败时不得越过这一页。
      const update = flow.push(result)
      pageResults.push(result)
      renderPage(layout.leftPane, result)
      displayFlow(update, false)
      appendReadyRequests(requestPane, update, mismatches)
      updateCompare()
    } catch (error) {
      status.textContent = `第 ${i} 页处理失败，已停止：${error instanceof Error ? error.message : String(error)}`
      console.error(`[pdf-verify] 第 ${i} 页`, error)
      return
    }
  }
  const final = flow.finish()
  displayFlow(final, true)
  appendReadyRequests(requestPane, final, mismatches)
  updateCompare()
  if (pdfKey) status.textContent += `；切片：复用 ${reusedPages} 页，新录 ${recordedPages} 页`
}

async function processOnePage(
  index: number,
  pdfKey: string | null,
  onSlicePage: (reused: boolean) => void,
): Promise<PageResult> {
  const page = await doc!.getPage(index)
  const canvas = document.createElement("canvas")
  const { width: cssW, height: cssH } = await renderPageToCanvas(page, canvas, RENDER_SCALE)
  const items = await getTextItems(page)
  const saved = pdfKey ? await readSlicePage(pdfKey, index, cssW, cssH) : null
  let regions = saved
  if (!regions) {
    runner ??= await LayoutModelRunner.load(extUrl("doclayout_yolo.onnx"), undefined, {
      forceWasm: new URLSearchParams(location.search).has("wasm"),
    })
    regions = await runner.predictPage(canvas, cssW, cssH)
    if (pdfKey) await writeSlicePage(pdfKey, index, cssW, cssH, regions)
  }
  if (pdfKey) onSlicePage(saved !== null)
  canvas.width = canvas.height = 0
  const input = { index, cssW, cssH, rotate: page.rotate, items, regions }
  const lineOrder = analyzePage({ ...input, paragraphTextOrder: "line" })
  const analysis = analyzePage(input)
  const lineOrderTexts = analysis.blocks.map((block, blockIndex) =>
    block.paras.map((para) => {
      const old = lineOrder.blocks[blockIndex]?.paras.find(
        (candidate) =>
          Math.abs(candidate.x - para.x) < 0.02 &&
          Math.abs(candidate.y - para.y) < 0.02 &&
          Math.abs(candidate.w - para.w) < 0.02 &&
          Math.abs(candidate.h - para.h) < 0.02,
      )
      return old?.text ?? "（旧方案没有对应段落框）"
    }),
  )
  console.log("[regions]" + JSON.stringify({ page: index, cssW, cssH, regions }))
  console.log(
    "[order]" +
      JSON.stringify({
        page: index,
        seq: analysis.order.seq.map((block) => ({
          cls: block.region?.className ?? "orphan",
          text: block.paras.map((p) => p.text),
        })),
      }),
  )
  return {
    ...analysis,
    lineOrderTexts,
    groupHits: new Map(),
    numbers: new Map(),
    overlay: document.createElement("div"),
  }
}

/** 只把共用文档状态投影到验证界面，不另算归属、排序或配对。 */
function displayFlow(update: FlowUpdate, complete: boolean): void {
  if (!doc || !statusEl || !rightPaneEl) return
  const { groups, decisions, pending } = update
  crossPageGroups.clear()
  let nextNumber = 1
  for (const result of pageResults) {
    result.groupHits.clear()
    result.numbers.clear()
    for (const block of result.order.seq)
      if (block.region?.className === "plain text" || block.region?.className === "title")
        result.numbers.set(block, nextNumber++)
  }
  groups.forEach((group, gid) => {
    const refs: GroupRef[] = []
    for (const part of group.parts) {
      refs.push({
        pageIndex: part.pageIndex,
        blockId: part.blockId,
        paraIdx: part.paraIdx,
        text: part.paragraph.text,
      })
      const result = pageResults[part.pageIndex - 1]!
      const hits = result.groupHits.get(gid) ?? []
      hits.push({ block: part.block, paraIdx: part.paraIdx })
      result.groupHits.set(gid, hits)
    }
    crossPageGroups.set(gid, refs)
  })
  panelStats = {
    merged: decisions.filter((d) => d.merged).length,
    failed: decisions.filter((d) => !d.merged && !d.sameColumn).length,
    sameColumn: decisions.filter((d) => d.sameColumn).length,
  }
  const gidOfDecision = new Map<PairDecision, number>()
  groups.forEach((group, gid) => {
    for (const decision of group.decisions) gidOfDecision.set(decision, gid)
  })
  panelEntries = []
  const shownGroups = new Set<number>()
  for (const decision of decisions) {
    if (decision.sameColumn) continue
    if (decision.merged) {
      const gid = gidOfDecision.get(decision)
      if (gid === undefined || shownGroups.has(gid)) continue
      shownGroups.add(gid)
      panelEntries.push({
        kind: "group",
        gid,
        refs: crossPageGroups.get(gid) ?? [],
        decisions: groups[gid]!.decisions,
      })
    } else panelEntries.push({ kind: "failed", decision })
  }
  for (const result of pageResults) drawOverlay(result)
  renderGroupPanel(rightPaneEl)
  statusEl.textContent = complete
    ? `完成：${doc.numPages} 页，共 ${groups.length} 组`
    : `已处理 ${pageResults.length}/${doc.numPages} 页，共 ${groups.length} 组；等待接续 ${pending.length} 段`
}

function buildLayout() {
  const toolbar = document.createElement("div")
  toolbar.className = "toolbar"
  const reloadBtn = document.createElement("button")
  reloadBtn.textContent = "重新选择 PDF"
  reloadBtn.addEventListener("click", () => renderFilePicker())
  toolbar.appendChild(reloadBtn)

  // 检测框来源：切换后只重绘 overlay，不重跑模型推理、归属、阅读序与配对
  const boxLabel = document.createElement("label")
  boxLabel.className = "toolbar-label"
  boxLabel.textContent = "检测框："
  const boxSel = document.createElement("select")
  boxSel.className = "toolbar-select"
  const repairedOpt = document.createElement("option")
  repairedOpt.value = "repaired"
  repairedOpt.textContent = "补框后（横向吸收）"
  const rawOpt = document.createElement("option")
  rawOpt.value = "raw"
  rawOpt.textContent = "原框（YOLO）"
  boxSel.append(repairedOpt, rawOpt)
  boxSel.value = boxMode
  boxSel.addEventListener("change", () => {
    boxMode = boxSel.value as BoxMode
    redrawOverlays()
  })
  boxLabel.appendChild(boxSel)
  toolbar.appendChild(boxLabel)

  const paragraphLabel = document.createElement("label")
  paragraphLabel.className = "toolbar-label"
  const paragraphCheck = document.createElement("input")
  paragraphCheck.type = "checkbox"
  paragraphCheck.checked = showParagraphBoxes
  paragraphCheck.addEventListener("change", () => {
    showParagraphBoxes = paragraphCheck.checked
    redrawOverlays()
  })
  paragraphLabel.append(paragraphCheck, "段落的框")
  toolbar.appendChild(paragraphLabel)

  const panes = document.createElement("div")
  panes.className = "panes"
  const leftPane = document.createElement("div")
  leftPane.className = "pane pane--left"
  const middlePane = document.createElement("div")
  middlePane.className = "pane pane--middle"
  const requestHeader = document.createElement("div")
  requestHeader.className = "panel-header"
  requestHeader.textContent = "送翻文本 A/B 对照"
  middlePane.appendChild(requestHeader)
  const rightPane = document.createElement("div")
  rightPane.className = "pane pane--right"
  panes.append(leftPane, middlePane, rightPane)
  return { toolbar, panes, leftPane, middlePane, rightPane }
}

function appendReadyRequests(
  container: HTMLElement,
  update: FlowUpdate,
  mismatches: Array<{
    label: string
    card: HTMLElement
    part: FlowUpdate["ready"][number]["parts"][number]
  }>,
): void {
  for (const unit of update.ready) {
    const card = document.createElement("div")
    card.className = "request-card"
    const title = document.createElement("div")
    title.className = "request-title"
    const pages = [...new Set(unit.parts.map((part) => part.pageIndex))]
    title.textContent = `${unit.kind === "group" ? "合并组" : unit.kind === "title" ? "标题" : "段落"} · ${pages.map((page) => `P${page}`).join(" → ")}`
    const lineUnit = {
      ...unit,
      parts: unit.parts.map((part) => {
        const blockIndex = Number(part.blockId.slice(1))
        const text = pageResults[part.pageIndex - 1]?.lineOrderTexts[blockIndex]?.[part.paraIdx]
        return {
          ...part,
          paragraph: { ...part.paragraph, text: text ?? "（旧方案没有对应段落框）" },
        }
      }),
    }
    const lineText = requestTextForUnit(lineUnit)
    const flowText = requestTextForUnit(unit)
    const lineCompared = lineText.replace(/\s/g, "")
    const flowCompared = flowText.replace(/\s/g, "")
    if (lineCompared !== flowCompared && unit.parts[0]) {
      const part = unit.parts[0]
      const ordered = pageResults.flatMap((result) => result.order.seq)
      const position = ordered.indexOf(part.block)
      const numbered = ordered
        .map((block, index) => ({
          number: pageResults.find((result) => result.numbers.has(block))?.numbers.get(block),
          index,
        }))
        .filter((entry): entry is { number: number; index: number } => entry.number !== undefined)
      const exact = pageResults[part.pageIndex - 1]?.numbers.get(part.block)
      const nearest = numbered.reduce<{ number: number; index: number } | undefined>(
        (best, entry) =>
          !best || Math.abs(entry.index - position) < Math.abs(best.index - position)
            ? entry
            : best,
        undefined,
      )
      mismatches.push({
        label:
          exact !== undefined
            ? `第${exact}`
            : nearest
              ? `第${nearest.number}附近`
              : `P${part.pageIndex}附近`,
        card,
        part,
      })
    }
    const [start, lineEnd, flowEnd] = differingRange(lineCompared, flowCompared)
    for (const [label, text] of [
      ["A · 原成行方案", lineText],
      ["B · 内容流方案（当前送翻）", flowText],
    ] as const) {
      const heading = document.createElement("div")
      heading.className = "request-variant"
      heading.textContent = label
      const body = document.createElement("pre")
      body.className = "request-text"
      const end = label.startsWith("A") ? lineEnd : flowEnd
      if (start < end) {
        const [originalStart, originalEnd] = originalRange(text, start, end)
        body.append(document.createTextNode(text.slice(0, originalStart)))
        const changed = document.createElement("span")
        changed.className = "request-changed"
        changed.textContent = text.slice(originalStart, originalEnd)
        body.append(changed, document.createTextNode(text.slice(originalEnd)))
      } else body.textContent = text
      card.append(heading, body)
    }
    const difference = document.createElement("div")
    difference.className = "request-difference"
    difference.textContent = summarizeTextDifference(lineCompared, flowCompared)
    card.appendChild(difference)
    card.prepend(title)
    container.appendChild(card)
  }
}

function originalRange(text: string, start: number, end: number): [number, number] {
  const positions: number[] = []
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i]!)) positions.push(i)
  return [positions[start]!, positions[end - 1]! + 1]
}

function differingRange(a: string, b: string): [number, number, number] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  return [start, endA, endB]
}

function summarizeTextDifference(a: string, b: string): string {
  if (a === b) return "差异：文本一致"
  const [start, endA, endB] = differingRange(a, b)
  const brief = (text: string) => (text.length > 40 ? `${text.slice(0, 40)}…` : text || "（无）")
  return `差异：A「${brief(a.slice(start, endA))}」→ B「${brief(b.slice(start, endB))}」`
}

function renderPage(container: HTMLElement, result: PageResult): void {
  const pageWrap = document.createElement("div")
  pageWrap.className = "page-wrap"
  pageWrap.dataset.page = String(result.index)

  const header = document.createElement("div")
  header.className = "page-header"
  header.textContent = `第 ${result.index} 页`
  pageWrap.appendChild(header)

  const canvasWrap = document.createElement("div")
  canvasWrap.className = "canvas-wrap"
  const canvas = document.createElement("canvas")
  void (async () => {
    const page = await doc!.getPage(result.index)
    await renderPageToCanvas(page, canvas, RENDER_SCALE)
    canvas.style.width = `${result.cssW}px`
    canvas.style.height = `${result.cssH}px`
  })()
  canvasWrap.appendChild(canvas)

  const overlay = document.createElement("div")
  overlay.className = "overlay"
  overlay.style.width = `${result.cssW}px`
  overlay.style.height = `${result.cssH}px`
  result.overlay = overlay

  canvasWrap.appendChild(overlay)
  pageWrap.appendChild(canvasWrap)
  container.appendChild(pageWrap)
  drawOverlay(result)
}

/** overlay 整体重绘：检测框 + 同段组高亮 + 阅读顺序编号 */
/** 只重绘各页 overlay（换检测框来源用；不重跑推理/归属/阅读序/配对） */
function redrawOverlays(): void {
  for (const r of pageResults) if (r.overlay.isConnected) drawOverlay(r)
}

function displayBox(
  result: PageResult,
  box: { x: number; y: number; w: number; h: number },
): string {
  const d = blockDisplayTransform(box, result.pageWu, result.pageHu, result.rotate)
  const top = result.rotate === 0 ? result.pageHu - box.y - box.h : d.top
  return `left:${d.left}px;top:${top}px;width:${d.width}px;height:${d.height}px;transform-origin:top left;transform:rotate(${d.rotateDeg}deg);`
}

function drawOverlay(result: PageResult): void {
  const overlay = result.overlay
  overlay.replaceChildren()

  // 检测框（按类别着色）：补框后区域是 y-up，原框是 y-down，overlay 一律 y-down
  const drawBoxes = boxMode === "repaired" ? result.regionsDown : result.regions
  for (const r of drawBoxes) {
    const color = CLASS_COLORS[r.className] ?? FALLBACK_COLOR
    const box = document.createElement("div")
    box.className = "region-box"
    const top = r.y1
    box.style.cssText =
      `left:${r.x1}px;top:${top}px;width:${r.x2 - r.x1}px;height:${r.y2 - r.y1}px;` +
      `border-color:${color};background:${color}22`
    box.title = `${r.className} ${(r.conf * 100).toFixed(0)}%`
    overlay.appendChild(box)
  }

  // 同段组高亮（Paragraph 是 y-up，overlay 是 y-down）
  for (const [gid, hits] of result.groupHits) {
    const color = groupColor(gid)
    for (const { block, paraIdx } of hits) {
      const p = block.paras[paraIdx]
      if (!p) continue
      const box = document.createElement("div")
      box.className = "para-box"
      box.style.cssText = displayBox(result, p) + `border-color:${color};background:${color}33`
      box.title = `组 G${gid}\n${p.text.slice(0, 120)}${p.text.length > 120 ? "…" : ""}`
      const label = document.createElement("span")
      label.className = "para-label"
      label.textContent = `G${gid}`
      label.style.color = color
      box.appendChild(label)
      overlay.appendChild(box)
    }
  }

  if (showParagraphBoxes) {
    for (const block of result.blocks) {
      for (const p of block.paras) {
        const box = document.createElement("div")
        box.className = "paragraph-outline"
        box.style.cssText = displayBox(result, p)
        box.title = p.text.slice(0, 120)
        overlay.appendChild(box)
      }
    }
  }

  // 全局阅读顺序编号：块 YOLO 原框左上角（region 是 y-up，overlay 是 y-down）
  const fontSize = Math.max(9, Math.round(result.cssW * 0.014))
  for (const [block, num] of result.numbers) {
    const r = block.region
    const left = r ? Math.min(r.x1, r.x2) : Math.min(...block.paras.map((p) => p.x))
    const topY = r ? Math.max(r.y1, r.y2) : Math.max(...block.paras.map((p) => p.y + p.h))
    const badge = document.createElement("span")
    badge.className = "order-badge"
    badge.textContent = String(num)
    const anchor = blockDisplayTransform(
      { x: left, y: topY, w: 0, h: 0 },
      result.pageWu,
      result.pageHu,
      result.rotate,
    )
    const top = result.rotate === 0 ? result.pageHu - topY : anchor.top
    badge.style.cssText = `left:${anchor.left}px;top:${top}px;font-size:${fontSize}px;`
    overlay.appendChild(badge)
  }
}

/** 条目预览：前五词…后三词；不足九词时完整显示。 */
function previewText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim()
  const words = t.split(" ")
  return words.length > 8 ? `${words.slice(0, 5).join(" ")}…${words.slice(-3).join(" ")}` : t
}

/** 每次配对判定单独成卡：结论与编号、两段摘录、总分与分项。 */
function appendPairCard(container: HTMLElement, d: PairDecision, gid?: number): void {
  const r1 = (n: number) => Math.round(n * 10) / 10
  const max = d.breakdown.items.reduce((a, i) => a + i.max, 0)
  const card = document.createElement("div")
  card.className = "group-card"
  const title = document.createElement("div")
  title.className = "pair-title"
  const verdict = document.createElement("span")
  verdict.className = d.merged ? "verdict-ok" : "verdict-no"
  verdict.textContent = d.merged ? "✓" : "✗"
  const tailNumber = pageResults[d.tailPage - 1]?.numbers.get(d.tailBlock) ?? "?"
  const headNumber = pageResults[d.headPage - 1]?.numbers.get(d.headBlock) ?? "?"
  const pageLabel = d.crossPage ? `P${d.tailPage}→P${d.headPage} 跨页` : `P${d.headPage}`
  title.append(
    verdict,
    ` ${pageLabel} · 段${tailNumber}→段${headNumber}${gid === undefined ? "" : ` · G${gid}`}`,
  )
  card.appendChild(title)

  for (const source of [d.tailText, d.headText]) {
    const excerpt = document.createElement("div")
    excerpt.className = "pair-excerpt"
    excerpt.textContent = `— ${previewText(source)}`
    card.appendChild(excerpt)
  }

  const scoreLine = document.createElement("div")
  scoreLine.className = "pair-score"
  if (d.hardStop) scoreLine.append("句末硬停 ")
  const total = document.createElement("span")
  total.className = d.merged ? "verdict-ok" : "verdict-no"
  total.textContent = d.hardStop
    ? `（${r1(d.breakdown.total)}/${max}）`
    : `${r1(d.breakdown.total)}/${max}`
  scoreLine.appendChild(total)
  if (!d.merged && !d.hardStop) scoreLine.append(` · 低于阈值 ${d.threshold}`)
  scoreLine.append(
    ` · ${d.breakdown.items.map((i) => `${i.label} ${r1(i.score)}/${i.max}`).join(" · ")}`,
  )
  card.appendChild(scoreLine)
  container.appendChild(card)
}

/** 同段组的每次成功配对各占一张判定卡。 */
function appendGroupCard(
  container: HTMLElement,
  entry: Extract<PanelEntry, { kind: "group" }>,
): void {
  const members = document.createElement("div")
  members.className = "group-item"
  members.style.borderLeft = `3px solid ${groupColor(entry.gid)}`
  members.textContent =
    `G${entry.gid}：` +
    entry.refs
      .map((ref) => `P${ref.pageIndex} ${ref.blockId}/${ref.paraIdx + 1} ${previewText(ref.text)}`)
      .join(" → ")
  container.appendChild(members)
  for (const d of entry.decisions) appendPairCard(container, d, entry.gid)
}

/** 右栏：头部计数 + 成功/失败连续时间线（按阅读序，不分区块） */
function renderGroupPanel(container: HTMLElement): void {
  container.replaceChildren()
  const header = document.createElement("div")
  header.className = "panel-header"
  header.textContent =
    `同段组（${crossPageGroups.size} 组）` +
    ` · 成功 ${panelStats.merged} 对` +
    ` · 失败 ${panelStats.failed} 对` +
    (panelStats.sameColumn > 0 ? ` · 同栏相邻不判 ${panelStats.sameColumn} 对` : "")
  container.appendChild(header)
  if (panelEntries.length === 0) {
    const empty = document.createElement("div")
    empty.className = "group-item"
    empty.textContent = "没有配到任何同段组"
    container.appendChild(empty)
    return
  }
  for (const entry of panelEntries) {
    if (entry.kind === "group") {
      appendGroupCard(container, entry)
      continue
    }
    appendPairCard(container, entry.decision)
  }
}

void main()
