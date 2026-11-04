import type { Region } from "../layout/model-runner"
import { sameTextLine, type PdfTextItem } from "../pdf/text-items"

/** 行摘要（阅读顺序，上→下）：跨栏合并闸门/裁信的数据基础，不含 y（顺序即语义） */
export interface ParaLine {
  x: number
  w: number
  h: number
  text: string
}

export interface Paragraph {
  x: number
  y: number
  w: number
  h: number
  text: string
  lineCount: number
  fontSize: number
  lines: ParaLine[]
  /** 跨栏合并组的成员段标记 */
  soloCluster?: boolean
}

export interface AssignedBlock {
  region: Region | null
  behavior: "translate" | "keep" | "skip"
  paras: Paragraph[]
  /** 块内文本项的最小内容流序号（阅读序 cid 的依据）；无文本项时给唯一递增值 */
  minOrder: number
}

/** 会产出段落的块：keep 之外、且有段落 */
export function rendersText(b: AssignedBlock): boolean {
  return b.behavior !== "keep" && b.paras.length > 0
}

interface Line {
  x: number
  y: number
  w: number
  h: number
  text: string
  items: PdfTextItem[]
}

/** 行的纵向隔离判定：与最近其它行（纵向差 >2px）的距离超过 max(16, 1.5×行高) */
export function isIsolatedLine(line: Line, allLines: Line[]): boolean {
  const nearest = Math.min(
    ...allLines
      .filter((l2) => l2 !== line && Math.abs(l2.y - line.y) > 2)
      .map((l2) => Math.abs(l2.y - line.y)),
    Infinity,
  )
  return nearest > Math.max(16, line.h * 1.5)
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  return s.length % 2 ? s[s.length >> 1]! : (s[s.length >> 1]! + s[(s.length >> 1) - 1]!) / 2
}

/** 上下标判定：item 高小于正文高的 0.8 */
const SUB_SCALE = 0.8

/** 行内压盖判定的宽比阈值：与行内某 item 的水平重叠达到自身宽的 60% 即视为"被压盖" */
const OVERLAP_EXCLUDE_RATIO = 0.6

/** 段末行判定（块内切段专用），刻意本地定义，避免底层依赖上层 */
const PARA_END_RE = /[.!?;:。！？；…]["”’」』）)》】\]]*$/

/** 该 item 是否与行内某个 item 水平压盖（重叠 ≥ 自身宽的 60%） */
function overlapsLine(it: PdfTextItem, lineItems: PdfTextItem[], requireLarger = false): boolean {
  if (!(it.w > 0)) return false
  const ratio = OVERLAP_EXCLUDE_RATIO * it.w
  return lineItems.some(
    (o) =>
      o !== it &&
      (!requireLarger || o.w >= it.w) &&
      Math.min(it.x + it.w, o.x + o.w) - Math.max(it.x, o.x) >= ratio,
  )
}

/** 行装配纠正轮：把"与所在组水平压盖"的 item 挪到不压盖、且盒顶差最小的组 */
function excludeOverlappingGroups(groups: PdfTextItem[][]): void {
  const anchorY = (g: PdfTextItem[]): number => (g.length > 0 ? g[0]!.y : -Infinity)
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]!
    if (g.length <= 1) continue
    const conflicts = g.filter((it) => overlapsLine(it, g, true))
    for (const it of conflicts) {
      let best = -1
      let bestDy = Infinity
      for (let gj = 0; gj < groups.length; gj++) {
        const cand = groups[gj]!
        if (gj === gi || cand.length === 0 || !sameTextLine(it, cand[0]!) || overlapsLine(it, cand))
          continue
        const dy = Math.abs(anchorY(cand) - it.y)
        if (dy < bestDy) {
          bestDy = dy
          best = gj
        }
      }
      if (best < 0) continue
      const idx = g.indexOf(it)
      if (idx < 0) continue
      g.splice(idx, 1)
      groups[best]!.push(it)
    }
  }
}

function lineText(items: PdfTextItem[]): string {
  let text = ""
  let prevEnd: number | null = null
  for (const it of items) {
    if (prevEnd !== null && it.x - prevEnd > 1.5 && !/\s$/.test(text) && !/^\s/.test(it.str))
      text += " "
    text += it.str
    prevEnd = Math.max(prevEnd ?? -Infinity, it.x + it.w)
  }
  return text
}

/** 段落框只决定归属；段内文字沿用 pdf.js 字项的原始顺序。 */
function textInParagraphBox(items: PdfTextItem[], para: Paragraph): string {
  const epsilon = 0.02
  const inBox = items
    .filter((it) => {
      const cx = it.x + it.w / 2
      const cy = it.y - it.h / 2
      return (
        cx >= para.x - epsilon &&
        cx <= para.x + para.w + epsilon &&
        cy >= para.y - epsilon &&
        cy <= para.y + para.h + epsilon
      )
    })
    .sort((a, b) => a.order - b.order)
  let text = ""
  let prev: PdfTextItem | undefined
  for (const it of inBox) {
    if (prev && !/\s$/.test(text) && !/^\s/.test(it.str)) {
      const gap = it.x - (prev.x + prev.w)
      if (gap > 1.5 || (it.x < prev.x + prev.w - 10 && it.y < prev.y - 2)) text += " "
    }
    text += it.str
    prev = it
  }
  return text.trim()
}

/** 按纵向重叠和基线分行，组内按 x 排序。 */
function groupIntoLines(items: PdfTextItem[]): Line[] {
  if (items.length === 0) return []
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const groups: PdfTextItem[][] = []
  for (const it of sorted) {
    const last = groups[groups.length - 1]
    if (last && sameTextLine(last[0]!, it)) last.push(it)
    else groups.push([it])
  }
  excludeOverlappingGroups(groups)
  const lines: Line[] = []
  for (const g of groups) {
    if (g.length === 0) continue
    g.sort((a, b) => a.x - b.x)
    const x = Math.min(...g.map((it) => it.x))
    const y = Math.max(...g.map((it) => it.y))
    lines.push({
      x,
      y,
      w: Math.max(...g.map((it) => it.x + it.w)) - x,
      h: y - Math.min(...g.map((it) => it.y - (it.h || 10))),
      text: lineText(g),
      items: g,
    })
  }
  return lines
}

/** 悬挂小 item 允许偏离行盒的距离（× 行高） */
const SUB_HANG = 0.55

/** item 盒 [y-h, y] 与行盒 [boxBottom, boxTop] 的纵向分离距离（重叠 = 0） */
function boxDist(sTop: number, sBottom: number, boxTop: number, boxBottom: number): number {
  return Math.max(0, boxBottom - sTop, sBottom - boxTop)
}

/** Pass 2：小 item（上/下标）挂回基线行 */
function attachSubsup(small: PdfTextItem[], baseLines: Line[]): Set<PdfTextItem> {
  const attached = new Set<PdfTextItem>()
  const eligible = [...small].sort((a, b) => b.y - a.y)
  for (const s of eligible) {
    const sTop = s.y,
      sBottom = s.y - s.h
    const sBase = s.y - 0.8 * s.h
    let best: { line: Line; score: number; dist: number; xdist: number } | null = null
    for (const L of baseLines) {
      const horizontalDist = Math.max(0, L.x - (s.x + s.w), s.x - (L.x + L.w))
      if (horizontalDist > Math.max(2, SUB_HANG * L.h)) continue
      const dist = boxDist(sTop, sBottom, L.y, L.y - L.h)
      if (dist > SUB_HANG * L.h) continue
      const xs = [...L.items].sort((a, b) => a.x - b.x)
      let slack = Infinity
      for (let i = 1; i < xs.length; i++) {
        const gapL = xs[i - 1]!.x + xs[i - 1]!.w,
          gapR = xs[i]!.x
        if (gapR - gapL < 3) continue
        const overlap = Math.min(gapR, s.x + s.w) - Math.max(gapL, s.x)
        if (overlap < s.w * 0.6) continue
        slack = Math.min(slack, Math.abs(gapR - gapL - s.w))
      }
      let xdist = Infinity
      for (const it of L.items)
        xdist = Math.min(xdist, Math.abs(s.x - (it.x + it.w)), Math.abs(it.x - (s.x + s.w)))
      const baseDelta = Math.abs(L.y - 0.8 * L.h - sBase)
      const score = (Number.isFinite(slack) ? slack : 1e9) + baseDelta
      if (
        !best ||
        dist < best.dist ||
        (dist === best.dist && (score < best.score || (score === best.score && xdist < best.xdist)))
      ) {
        best = { line: L, score, dist, xdist }
      }
    }
    if (best) {
      best.line.items.push(s)
      best.line.items.sort((a, b) => a.x - b.x)
      const newX = Math.min(best.line.x, s.x)
      best.line.w = Math.max(best.line.x + best.line.w, s.x + s.w) - newX
      best.line.x = newX
      attached.add(s)
    }
  }
  return attached
}

export function buildLines(items: PdfTextItem[]): Line[] {
  if (items.length === 0) return []
  // Pass 0：正文字高 = 总字符量最大的 h
  const lenByH = new Map<number, number>()
  for (const it of items) lenByH.set(it.h, (lenByH.get(it.h) ?? 0) + it.str.length)
  let bodyH = 0
  let bestLen = -1
  for (const [h, len] of lenByH) {
    if (len > bestLen) {
      bodyH = h
      bestLen = len
    }
  }
  const full = items.filter((it) => it.h >= bodyH * SUB_SCALE)
  const small = items.filter((it) => it.h < bodyH * SUB_SCALE)
  // Pass 1：全尺寸 item 生成基线行
  const baseLines = groupIntoLines(full)
  // Pass 2：小 item（上/下标）挂回基线行
  const attached = attachSubsup(small, baseLines)
  for (const line of baseLines) line.text = lineText(line.items)
  // Pass 3：未挂上的小 item 自成行；合并后按 y 降序
  const leftover = small.filter((it) => !attached.has(it))
  return [...baseLines, ...groupIntoLines(leftover)].sort((a, b) => b.y - a.y || a.x - b.x)
}

/** barriers：keep 区域（y-up，已外扩）——段落不得跨过它合并 */
function gapHitsBarrier(prev: Line, ln: Line, barriers: Region[] | null): boolean {
  if (!barriers) return false
  const bandY1 = ln.y
  const bandY2 = prev.y - prev.h
  if (bandY2 - bandY1 <= 0) return false
  const x1 = Math.min(prev.x, ln.x),
    x2 = Math.max(prev.x + prev.w, ln.x + ln.w)
  return barriers.some(
    (b) =>
      Math.min(bandY2, b.y2) - Math.max(bandY1, b.y1) > 0 &&
      Math.min(x2, b.x2) - Math.max(x1, b.x1) > 0,
  )
}

/** 段落切分选项：xGap = 跨栏间隙阈值；baseLeading = 页级行距基准 */
interface ParagraphSplitOptions {
  xGap?: number
  baseLeading?: number
  detectHanging?: boolean
}

const HANGING_START_RE = /^(?:[A-Z（(【[]|\d{1,3}[.．、)）])/

function mergeParagraphs(
  lines: Line[],
  barriers: Region[] | null = null,
  opts: ParagraphSplitOptions = {},
): Paragraph[] {
  if (lines.length === 0) return []
  const gaps: number[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    const g = lines[i]!.y - lines[i + 1]!.y
    if (g > 0) gaps.push(g)
  }
  const lineH = median(lines.map((l) => l.h))
  const frameLeading = median(gaps)
  const leading =
    opts.baseLeading && opts.baseLeading > 0
      ? opts.baseLeading
      : frameLeading > 0
        ? frameLeading
        : lineH
  const threshold = Math.max(leading * 1.35, lineH * 1.2)
  const leftEdge = Math.min(...lines.map((l) => l.x))
  const leftTolerance = Math.max(6, lineH * 0.6)
  const indent = Math.max(8, lineH * 0.8)
  const leftLines = lines.filter((l) => l.x - leftEdge <= leftTolerance)
  const hanging =
    opts.detectHanging !== false &&
    lines.length > 5 &&
    leftLines.length >= 2 &&
    lines.some((l) => l.x - leftEdge > indent) &&
    leftLines.filter((l) => HANGING_START_RE.test(l.text.trimStart())).length / leftLines.length >
      0.8
  // 本块右缘（段末行判定用）
  const rightEdge = Math.max(...lines.map((l) => l.x + l.w))
  const paras: Paragraph[] = []
  let cur: Line[] = []
  const flush = () => {
    if (cur.length === 0) return
    const allItems = cur.flatMap((l) => l.items)
    const bottom = Math.min(...cur.map((l) => l.y - l.h), ...allItems.map((i) => i.y - i.h))
    const top = Math.max(...cur.map((l) => l.y), ...allItems.map((i) => i.y))
    let text = ""
    let prevEnd: number | null = null
    for (const ln of cur) {
      for (const it of ln.items) {
        if (prevEnd !== null && it.x - prevEnd > 1.5 && !/\s$/.test(text) && !/^\s/.test(it.str))
          text += " "
        text += it.str
        prevEnd = it.x + it.w
      }
      prevEnd = null
      text += " "
    }
    paras.push({
      x: Math.min(...cur.map((l) => l.x)),
      y: bottom,
      w: Math.max(...cur.map((l) => l.x + l.w)) - Math.min(...cur.map((l) => l.x)),
      h: top - bottom,
      text: text.trimEnd(),
      lineCount: cur.length,
      fontSize: median(cur.map((l) => l.h)),
      lines: cur.map((l) => ({ x: l.x, w: l.w, h: l.h, text: l.text })),
    })
    cur = []
  }
  for (const ln of lines) {
    const prev = cur[cur.length - 1]
    if (prev) {
      const gap = prev.y - ln.y
      const yBreak = gap > threshold
      const sameVisualLine = Math.abs(gap) <= 2
      const xBreak =
        ln.x - (prev.x + prev.w) > (sameVisualLine ? Infinity : (opts.xGap ?? SPLIT_GAP))
      // 段落边界特征：① 上一行段末短行 ② 首行缩进 ③ 上一行句末标点 ④ 下一行非小写开头
      const prevShort = rightEdge - (prev.x + prev.w) > Math.max(1.5 * lineH, 12)
      const paraLeft = Math.min(...cur.map((l) => l.x))
      const atLeft = Math.abs(ln.x - paraLeft) <= Math.max(4, 0.5 * ln.h)
      const indented = ln.x - paraLeft > Math.max(8, 0.8 * ln.h)
      const prevEndsSentence = PARA_END_RE.test(prev.text.trimEnd())
      const nextStartsUpper = !/^[a-z]/.test(ln.text.trimStart())
      const paragraphStart =
        prevShort &&
        gap >= leading * 0.9 &&
        (atLeft || indented) &&
        prevEndsSentence &&
        nextStartsUpper
      const hangingStart =
        hanging && ln.x - leftEdge <= leftTolerance && HANGING_START_RE.test(ln.text.trimStart())
      if (yBreak || xBreak || paragraphStart || hangingStart || gapHitsBarrier(prev, ln, barriers))
        flush()
    }
    cur.push(ln)
  }
  flush()
  return paras
}

/** 跨栏间隙阈值：本行整体跑到上一行右缘之外且空出这么多，视为跨栏/散段 */
const SPLIT_GAP = 8
/** keep 区域判定外扩 */
export const KEEP_MARGIN = 6

function centerIn(item: PdfTextItem, r: Region, margin = 0): boolean {
  const cx = item.x + item.w / 2,
    cy = item.y - item.h / 2
  return cx >= r.x1 - margin && cx <= r.x2 + margin && cy >= r.y1 - margin && cy <= r.y2 + margin
}

/** 模型区域是 CSS y-down；文字 item 是 PDF y-up。换到 y-up：y1' = pageH - y2，y2' = pageH - y1 */
export function flipRegionY(region: Region, pageH: number): Region {
  return { ...region, y1: pageH - region.y2, y2: pageH - region.y1 }
}

function isCaption(r: Region): boolean {
  return (
    r.className === "figure_caption" ||
    r.className === "table_caption" ||
    r.className === "table_footnote" ||
    r.className === "formula_caption"
  )
}

/** item 是否由 keep 认领：与 assignItems 的优先级一致，供 coverage 分母使用 */
export function isKeepOnlyItem(item: PdfTextItem, regions: Region[]): boolean {
  if (regions.some((r) => r.behavior === "translate" && isCaption(r) && centerIn(item, r)))
    return false
  if (regions.some((r) => r.behavior === "keep" && centerIn(item, r))) return true
  if (regions.some((r) => r.behavior === "translate" && centerIn(item, r))) return false
  return regions.some((r) => r.behavior === "keep" && centerIn(item, r, KEEP_MARGIN))
}

/** 文档典型行距：各 translate 区域内部行距中位数的中位数 */
export function estimateBaseLeading(items: PdfTextItem[], regions: Region[]): number {
  const perRegion: number[] = []
  for (const r of regions) {
    if (r.behavior !== "translate") continue
    const inR = items.filter((it) => centerIn(it, r, 0))
    if (inR.length === 0) continue
    const lines = buildLines(inR)
    const gs: number[] = []
    for (let i = 0; i + 1 < lines.length; i++) {
      const d = lines[i]!.y - lines[i + 1]!.y
      if (d > 0) gs.push(d)
    }
    const m = median(gs)
    if (m > 0) perRegion.push(m)
  }
  return median(perRegion)
}

/** 漂浮干扰项丢弃：页码、公式编号、页边标记等（Δy 大、飘在行外的文字） */
export function dropFloatingParas(
  blocks: AssignedBlock[],
  baseLeading: number,
): { count: number; len: number } {
  let count = 0,
    len = 0
  if (!(baseLeading > 0)) return { count, len }
  const limit = baseLeading * 2.5
  const centers: Array<{ p: Paragraph; cy: number }> = []
  for (const b of blocks) {
    if (!rendersText(b)) continue
    for (const p of b.paras) centers.push({ p, cy: p.y + p.h / 2 })
  }
  for (const b of blocks) {
    if (!rendersText(b) || b.region?.className === "title") continue
    const kept: Paragraph[] = []
    for (const p of b.paras) {
      const cy = p.y + p.h / 2
      const isolated = centers.every((c) => c.p === p || Math.abs(c.cy - cy) > limit)
      const t = p.text.trim()
      const tiny = t.length <= 8 || !/[A-Za-z\u4e00-\u9fff]/.test(t)
      if (isolated && tiny) {
        count++
        len += p.text.length
        continue
      }
      kept.push(p)
    }
    b.paras = kept
  }
  return { count, len }
}

/** 排他认领：每个文字 item 只归一个区域，然后按区域建块、块内切段 */
export function assignItems(
  items: PdfTextItem[],
  regions: Region[],
  pageW: number,
  pageH: number,
  paragraphTextOrder: "line" | "content" = "content",
): AssignedBlock[] {
  const blocks: AssignedBlock[] = []
  // keep 区域（外扩）作为段落合并屏障
  const barriers = regions
    .filter((r) => r.behavior === "keep")
    .map((r) => ({
      ...r,
      x1: r.x1 - KEEP_MARGIN,
      y1: r.y1 - KEEP_MARGIN,
      x2: r.x2 + KEEP_MARGIN,
      y2: r.y2 + KEEP_MARGIN,
    }))
  const consumed = new Set<PdfTextItem>()
  const claimedBy = new Map<PdfTextItem, Region>()
  const claim = (r: Region, margin: number) => {
    for (const it of items) {
      if (consumed.has(it)) continue
      if (!centerIn(it, r, margin)) continue
      consumed.add(it)
      claimedBy.set(it, r)
    }
  }
  const translateRegions = regions
    .filter((r) => r.behavior === "translate")
    .sort((a, b) => b.conf - a.conf)
  const keepRegions = regions.filter((r) => r.behavior === "keep")
  // 题注原框 → keep 原框 → 其他可翻译原框 → keep 外扩只接无主文字 → skip
  for (const r of translateRegions) if (isCaption(r)) claim(r, 0)
  for (const r of keepRegions) claim(r, 0)
  for (const r of translateRegions) if (!isCaption(r)) claim(r, 0)
  for (const r of keepRegions) claim(r, KEEP_MARGIN)
  const skipRegions = regions.filter((r) => r.behavior === "skip").sort((a, b) => b.conf - a.conf)
  for (const r of skipRegions) claim(r, 0)

  const baseLeading = estimateBaseLeading(items, translateRegions)

  // 无文本项的块给唯一递增值：minOrder 只用于相对排序，落在全部真实 order 之后即可
  let fallbackOrder = items.length
  const nextFallback = () => fallbackOrder++

  for (const r of regions) {
    const inR = items.filter((it) => claimedBy.get(it) === r)
    const paras =
      r.behavior === "keep" ? [] : mergeParagraphs(buildLines(inR), barriers, { baseLeading })
    if (paragraphTextOrder === "content")
      for (const para of paras) para.text = textInParagraphBox(inR, para)
    blocks.push({
      region: r,
      behavior: r.behavior,
      paras,
      minOrder: inR.length > 0 ? Math.min(...inR.map((it) => it.order)) : nextFallback(),
    })
  }
  const orphan = items.filter((it) => !claimedBy.has(it))
  if (orphan.length > 0) {
    const paras = mergeParagraphs(buildLines(orphan), barriers, {
      baseLeading,
      detectHanging: false,
    })
    if (paragraphTextOrder === "content")
      for (const para of paras) para.text = textInParagraphBox(orphan, para)
    blocks.push({
      region: null,
      behavior: "translate",
      paras,
      minOrder: Math.min(...orphan.map((it) => it.order)),
    })
  }
  void pageW
  void pageH
  return blocks
}
