import type { PageTypography } from "./page-typography"
import type { PageHost } from "./pagehost"
import { rendersText, type AssignedBlock, type Paragraph } from "@/modules/pdf-core/assign/assign"
import { splitByRatio } from "../translate/sentence-split"

/** 块内的一个"簇"：一小组纵向邻接（且横向相交）的段落，共用一个**原位**白底盒。
 *  `idx` = 各段在 `BlockView.paras` 中的下标——译文按这个映射回填（不依赖遍历顺序）。
 *  `geo`/`fontSize` 是分配层（fit-text / trans-units）估算盒容量的输入：jsdom 无布局引擎，
 *  `offsetWidth/offsetHeight` 恒 0，容量只能由这里的原始几何算出；两者与写进 inline style 的值同源。 */
export interface BlockCluster {
  box: HTMLElement
  idx: number[]
  /** 簇盒的原位几何（y-up，与 Paragraph 同口径） */
  geo: DisplayBox
  /** 盒内基准字号（CSS px），即写入 `font-size` 的值 */
  fontSize: number
  lineHeight?: number
}

export interface BlockView {
  blockId: string
  paras: Paragraph[]
  /** 容器：只作分组与 z 序单位（自身 0×0 且透明，白底交给簇盒） */
  el: HTMLElement
  clusters: BlockCluster[]
  /** 标题类块（region.className === "title"）：整块一并送翻（不插 %% 分隔）、返回文本不拆段，
   *  且强制只有一个簇盒（标题行不给空盒盖住整条译文的机会） */
  noSegment: boolean
}

export interface BlockDisplay {
  left: number
  top: number
  width: number
  height: number
  rotateDeg: number
}

export interface DisplayBox {
  x: number
  y: number
  w: number
  h: number
}

/** 簇划分空隙下限（CSS px）：段间空隙 > max(3×段落高中位, CLUSTER_GAP) 即断开新簇 */
export const CLUSTER_GAP = 24

/** pendingParas 缺省空集：免得每次调用都 new Set 判断 */
const EMPTY_PARAS: ReadonlySet<Paragraph> = new Set()

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid]! + s[mid - 1]!) / 2
}

/** 段落矩形并集（y-up） */
function unionBox(paras: Paragraph[]): DisplayBox {
  const x = Math.min(...paras.map((p) => p.x))
  const y = Math.min(...paras.map((p) => p.y))
  const x2 = Math.max(...paras.map((p) => p.x + p.w))
  const y2 = Math.max(...paras.map((p) => p.y + p.h))
  return { x, y, w: x2 - x, h: y2 - y }
}

/** 块内段落 → 簇（返回下标分组，按 y 降序 = 从上到下）。
 *  为什么分簇：块盒原先是"块内全部段落矩形的并集"，段落一散开就成跨页巨盒 ——
 *  实测（2026-09-14，污水检测第 1 页）4 个 abandon 框的文字被整页兜底块收编，
 *  并集盒 x52-421 / y38-752（714px 高、263k px²），白底把左栏半页全盖掉。
 *  分簇后每簇只覆盖自己那几段 → 白底回到原位、互不相干。
 *  判据：上一段底到本段顶的空隙 ≤ max(3×段落高中位, CLUSTER_GAP)，且两段横向相交
 *  （横向不相交 = 左右并列，另起一簇）。
 *  `soloCluster` 段（跨栏合并组成员）强制独占一簇：即便邻接判据满足，
 *  前一段不并入它、其后一段也不并入它（该段的原文由合并单元统一渲染）。 */
export function clusterParas(paras: Paragraph[]): number[][] {
  const order = paras
    .map((_, i) => i)
    .sort((a, b) => paras[b]!.y - paras[a]!.y || paras[a]!.x - paras[b]!.x)
  const limit = Math.max(3 * median(paras.map((p) => p.h)), CLUSTER_GAP)
  const out: number[][] = []
  let soloLast = false // 上一簇是否为 solo 独簇（其后的段不得并入）
  for (const i of order) {
    const p = paras[i]!
    if (p.soloCluster) {
      out.push([i])
      soloLast = true
      continue
    } // 合并组成员独占白盒
    const cur = out[out.length - 1]
    if (cur && !soloLast) {
      const last = paras[cur[cur.length - 1]!]!
      const gap = last.y - (p.y + p.h) // y-up：上段底 → 本段顶（相邻/重叠时为负）
      const xOverlap = Math.min(last.x + last.w, p.x + p.w) - Math.max(last.x, p.x)
      if (gap <= limit && xOverlap > 0) {
        cur.push(i)
        continue
      }
    }
    out.push([i])
    soloLast = false
  }
  return out
}

/** 为 translate 块生成译文层：一个版面块对应一个容器，普通正文每段各有原位白底盒。
 *  【2026-09-14】容器不再自己铺白底/占位。原先是"块盒 = 块内全部段落矩形并集"，
 *  段落一散开（页眉 + 横幅 + 页脚被同一个块收编）就成跨页巨盒，白底盖掉半页；
 *  现在白底落到簇级、跟着段落原位走，容器只保留分组与 z 序（applyTextZOrder）职责。
 *  keep/skip 块不渲染。display：可选的显示变换（旋转页用，未旋转帧 → 显示位置 + CSS rotate），
 *  逐簇套用；缺省按 rotate=0 路径（top = pageH - (y+h)）。
 *  pendingParas：跨页挂起的候选尾段（spec 第 4 节）——**透明占位**（2026-09-16 语义修正）：
 *  照常参与分簇并建簇盒（位置/尺寸正确、idx 包含它），但盒子 background:transparent、不填文字，
 *  挂起期间原文从 canvas 透出（视觉等价于旧的"隐藏不建盒"方案）。
 *  为什么必须有盒：跨页合并命中时，回填方要往上一页的挂起尾段簇盒写译文——
 *  旧方案把盒藏掉导致回填静默落空（丢译文）。
 *  每段独盒，挂起段的透明背景不会影响邻段。
 *  解除挂起后由回填方（Task 8）写文字并把 background 改回 #fff，本函数不涂白。
 *  soloParas 参数保留供现有调用方使用；普通正文现在始终逐段独盒。
 *  簇下标（idx）仍指向 block.paras 全量下标，`BlockView.paras` 也保持原数组不动。 */
export function renderBlocks(
  host: PageHost,
  blocks: AssignedBlock[],
  _applyTranslate: (blockId: string, text: string) => void,
  display?: (box: DisplayBox) => BlockDisplay,
  pendingParas?: Set<Paragraph>,
  _soloParas?: Set<Paragraph>,
  typography?: PageTypography,
): BlockView[] {
  const out: BlockView[] = []
  const doc = host.root.ownerDocument
  const pageH = parseFloat(host.root.style.height)
  for (const block of blocks) {
    if (!rendersText(block)) continue
    const paras = block.paras
    const el = doc.createElement("div")
    el.className = "trans-block"
    const blockId = `b${blocks.indexOf(block)}`
    el.dataset.blockId = blockId
    // 容器 0×0 + 透明：只承载"分组 + 块级 z 序"，白底与落点全在簇盒上
    el.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none"
    // 标题类：不分段（送翻与回填都不拆），因此整块只有一个盒（见 BlockView.noSegment）
    const noSegment = block.region?.className === "title"
    // idx 映射回 paras 全量下标；标题仍按整体处理
    const allIdx = paras.map((_, i) => i)
    const pendingSet = pendingParas ?? EMPTY_PARAS
    const groups = noSegment ? [allIdx] : allIdx.map((i) => [i])
    const clusters: BlockCluster[] = groups.map((idx) => {
      const group = idx.map((i) => paras[i]!)
      const box = unionBox(group)
      const t = display
        ? display(box)
        : { left: box.x, top: pageH - (box.y + box.h), width: box.w, height: box.h, rotateDeg: 0 }
      const rot = t.rotateDeg
        ? `transform:rotate(${t.rotateDeg}deg);transform-origin:top left;`
        : ""
      const fontSize = median(group.map((p) => p.fontSize)) || 12
      const boxFontSize = typography?.fontSizeFor(block) ?? Math.max(fontSize * 0.9, 6)
      // 占位段独簇（上方强制）→ 盒背景透明、不填文字：原文透出，回填目标留给 Task 8
      const isPending = group.every((p) => pendingSet.has(p))
      // 占位盒用 background-color 长属性：jsdom 不解析 shorthand "background:transparent"（测试环境），
      // 浏览器侧两者等价
      const bg = isPending ? "background-color:transparent" : "background:#fff"
      const cluster = doc.createElement("div")
      cluster.className = "trans-cluster"
      // height 而非 min-height（overflow:hidden 语义，溢出由统一求解器接管）：
      // 盒高是求解结果（cluster-layout.ts），建盒时先用原位高占位，
      // 回填后由 applyClusterLayout 覆盖 —— 内容永远不许把盒子撑大
      cluster.style.cssText =
        `position:absolute;left:${t.left}px;top:${t.top}px;` +
        `width:${t.width}px;height:${t.height}px;${bg};font-size:${boxFontSize}px;` +
        `pointer-events:auto;${rot}`
      // 原位高/字号落成 data 属性：验收（clustersOvergrown）与统一求解器都要用，
      // 而 jsdom 下 offsetHeight 恒 0，不能靠实测 DOM 反推几何
      cluster.dataset.minHeight = String(t.height)
      cluster.dataset.baseFontSize = String(boxFontSize)
      el.appendChild(cluster)
      // geo 用**原位框**（unionBox 的 y-up 矩形）而非显示变换后的 t：容量估算只关心宽/高，
      // 旋转页的显示坐标（含 rotate 变换）在容量估算里不适用，故此处始终用 y-up 原位几何
      return {
        box: cluster,
        idx,
        geo: box,
        fontSize: boxFontSize,
        lineHeight: typography?.lineHeightFor(block),
      }
    })
    host.transLayer.appendChild(el)
    out.push({ blockId, paras, el, clusters, noSegment })
  }
  return out
}

/** 把簇内各段译文写进簇盒：段间用 `<br>` 分隔。
 *  用文本节点 + `<br>` 元素拼装，**不使用 innerHTML**（模型返回的文本不可信）。 */
export function fillBlockText(el: HTMLElement, paragraphs: string[]): void {
  const doc = el.ownerDocument
  el.replaceChildren()
  paragraphs.forEach((text, i) => {
    if (i > 0) el.appendChild(doc.createElement("br"))
    el.appendChild(doc.createTextNode(text))
  })
}

/** 段数对不上时，按原文字符数占比把译文切回各段。 */
function spreadByRatio(text: string, weights: number[]): string[] {
  const total = weights.reduce((s, w) => s + w, 0)
  if (total <= 0) return weights.map(() => "")
  return splitByRatio(
    text.trim(),
    weights.map((w) => w / total),
  )
}

/** 块级译文 → 各簇的文案。 */
export function distributeTexts(view: BlockView, segments: string[], raw: string): string[][] {
  if (raw.trim() === "") return view.clusters.map(() => []) // 空译文：各簇皆空（白底仍在，等下次翻译）
  const perPara = segments.length === view.paras.length ? segments : null
  if (!perPara) {
    const pieces = spreadByRatio(
      raw,
      view.paras.map((p) => p.text.length),
    )
    return view.clusters.map((cluster) => cluster.idx.map((i) => pieces[i] ?? ""))
  }
  return view.clusters.map((cluster) => cluster.idx.map((i) => perPara[i] ?? ""))
}

/** 带剔除段的映射：segments 依序对应未跳过的段（合并组成员由合并单元回填，这里得空串）。
 *  段数不符（模型没守 %% 约定）→ 未跳过的段按原文长度占比分整条译文（同 distributeTexts）。 */
export function distributeTextsSkip(
  view: BlockView,
  segments: string[],
  raw: string,
  skip: Set<number>,
): string[][] {
  const kept = view.paras.map((_, i) => i).filter((i) => !skip.has(i))
  const per = new Map<number, string>(view.paras.map((_, i) => [i, ""] as const))
  if (segments.length === kept.length) {
    kept.forEach((paraIdx, k) => per.set(paraIdx, segments[k] ?? ""))
  } else {
    const pieces = spreadByRatio(
      raw,
      kept.map((i) => view.paras[i]!.text.length),
    )
    kept.forEach((paraIdx, k) => per.set(paraIdx, pieces[k] ?? ""))
  }
  return view.clusters.map((c) => c.idx.map((i) => per.get(i) ?? ""))
}

export function createTwoPane(doc: Document): {
  left: HTMLElement
  right: HTMLElement
  syncScroll(): void
} {
  const container = doc.createElement("div")
  container.className = "two-pane"
  const left = doc.createElement("div")
  left.className = "pane pane-left"
  const right = doc.createElement("div")
  right.className = "pane pane-right"
  container.append(left, right)
  let syncing = false
  const sync = (from: HTMLElement, to: HTMLElement) => () => {
    if (syncing) return
    syncing = true
    to.scrollTop =
      (from.scrollTop * Math.max(to.scrollHeight - to.clientHeight, 1)) /
      Math.max(from.scrollHeight - from.clientHeight, 1)
    syncing = false
  }
  left.addEventListener("scroll", sync(left, right))
  right.addEventListener("scroll", sync(right, left))
  return { left, right, syncScroll: () => {} }
}

/** 重叠块层叠规则（按块算，簇内不打架）：按译文文字长度升序分配 z-index——有文字的盖住没文字的，
 *  文字多的盖住文字少的（空块=翻译失败时永远沉底）。在译文填充完成后调用 */
export function applyTextZOrder(views: BlockView[]): void {
  const sorted = [...views].sort(
    (a, b) => (a.el.textContent?.length ?? 0) - (b.el.textContent?.length ?? 0),
  )
  sorted.forEach((v, i) => {
    v.el.style.zIndex = String(i + 1)
  })
}
