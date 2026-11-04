import type { AssignedBlock, ParaLine, Paragraph } from "./assign"

/** 跨栏合并判定的最小输入：段落的首/末行信息 + 包络宽 + 字号 + 段级纵坐标（纵向间隙项用） */
export type MergeSide = Pick<Paragraph, "lines" | "w" | "fontSize" | "text" | "y" | "h">

/** 句末判定（闸门2 用，故意比裁信的切句集合宽：拒绝合并宁可错杀） */
export const SENTENCE_END_RE = /[.!?;:。！？；…]["”’」』）)》】\]]*$/

/** 停顿标点：话没说完、倾向续行的行尾符号。
 *  允许后跟闭引号/闭括号 */
export const PAUSE_RE = /[,，、–—（]["”’」』）)》】\]]*$/

/** 项目符号（闸门5 用）：图形符号单独出现即判 bullet，字母编号保留点号要求 */
const BULLET_RE = /^[•\-–*◦①-⑳⑴-⑶]|^[a-z]\./

function blockRight(lines: ParaLine[]): number {
  return Math.max(...lines.map((l) => l.x + l.w))
}
function blockLeft(lines: ParaLine[]): number {
  return Math.min(...lines.map((l) => l.x))
}

/** 尾行顶满：末行右缘距块右缘 ≤ 1 行高（同页闸门1 / 跨页尾侧门共用同一份语义） */
export function isTailFull(p: MergeSide): boolean {
  if (p.lines.length === 0) return false
  const last = p.lines[p.lines.length - 1]!
  return blockRight(p.lines) - (last.x + last.w) <= last.h
}

/** 尾行以句末标点收尾（true = 话已说完，不该续） */
export function tailHasSentenceEnd(p: MergeSide): boolean {
  if (p.lines.length === 0) return false
  const last = p.lines[p.lines.length - 1]!
  return SENTENCE_END_RE.test(last.text.trimEnd())
}

/** 打分权重（百分制整数，避免浮点累加误差）。七项打分对象：
 *  ① 纵向间隙（基线续接量，分档 0.15/0.10/0.05 —— 权重最大的项）
 *  ⑥ 尾行顶满 / 宽度接近（max(1−ratio,0)×0.15 的连续衰减）
 *  ③ 头行顶格（对齐/缩进，≈0.10~0.20）
 *  ④ 首字符寻常（行型替身，≈0.10）
 *  ⑤ 尾行无句末标点（命中句末表则跳过）
 *  ⑦ 尾行停顿标点（停顿表，倾向续） */
export const TAIL_HEAD_WEIGHTS = {
  verticalGap: 15, // ① 纵向间隙（同栏分档 15/10/5；跨栏/跨页无可比纵向量，固定 0 不参与）
  tailFull: 15, // ⑥ 尾行顶满（连续衰减：越贴右缘分越高）
  widthNear: 10, // ⑥ 宽度接近（连续衰减）
  headFlush: 10, // ③ 头行顶格（连续衰减）
  headPlainStart: 10, // ④ 头行首字符寻常（行型替身）
  tailNoSentenceEnd: 15, // ⑤ 尾行无句末标点（命中句末表 = 0，即"跳过奖励"）
  tailPauseEnd: 10, // ⑦ 尾行停顿标点（新增）
} as const

/** 配对作用域：纵向间隙项的取值方式随之不同（同栏/跨栏/跨页是三种不同的几何关系） */
export type TailHeadScope = "sameColumn" | "crossColumn" | "crossPage"

/** 同栏满分 = Σ权重 = 85 */
export const TAIL_HEAD_FULL_SCORE = Object.values(TAIL_HEAD_WEIGHTS).reduce((a, b) => a + b, 0)
/** 跨栏/跨页满分 = 85 − ①(15) = 70：①在跨场景固定 0，不占分 */
export const CROSS_FULL_SCORE = TAIL_HEAD_FULL_SCORE - TAIL_HEAD_WEIGHTS.verticalGap
/** 硬门（不参与打分）：空行、两块都单行、字号护栏（我们自有的护栏） */
function passHardGuards(tail: MergeSide, head: MergeSide): boolean {
  if (tail.lines.length === 0 || head.lines.length === 0) return false
  if (tail.lines.length === 1 && head.lines.length === 1) return false
  if (Math.abs(tail.fontSize - head.fontSize) > 0.15 * Math.max(tail.fontSize, head.fontSize))
    return false
  return true
}

/** 打分项展示标签 */
export const TAIL_HEAD_LABELS: Record<keyof typeof TAIL_HEAD_WEIGHTS, string> = {
  verticalGap: "纵向间隙",
  tailFull: "尾行顶满",
  widthNear: "宽度接近",
  headFlush: "头行顶格",
  headPlainStart: "首字符寻常",
  tailNoSentenceEnd: "尾行无句末",
  tailPauseEnd: "尾行停顿",
}

export interface ScoreItem {
  key: keyof typeof TAIL_HEAD_WEIGHTS
  label: string
  score: number
  max: number
}
export interface ScoreBreakdown {
  total: number
  items: ScoreItem[]
}

/** 尾↔头打分（逐项明细版）：项集与累加逻辑与 scoreTailHead 完全一致，只是把每项摊开返回。
 *  跨栏/跨页 scope 下 ① 纵向间隙固定 0 不占分，明细里不列该项（满分 70）。 */
export function scoreTailHeadBreakdown(
  tail: MergeSide,
  head: MergeSide,
  scope: TailHeadScope = "sameColumn",
): ScoreBreakdown {
  const items: ScoreItem[] = []
  const add = (key: keyof typeof TAIL_HEAD_WEIGHTS, score: number): void => {
    items.push({ key, label: TAIL_HEAD_LABELS[key], score, max: TAIL_HEAD_WEIGHTS[key] })
  }
  if (!passHardGuards(tail, head)) {
    // 硬门拦下 = 整体 0 分：列全项全 0，让面板能展示"为什么是 0"
    for (const key of Object.keys(TAIL_HEAD_WEIGHTS) as Array<keyof typeof TAIL_HEAD_WEIGHTS>) {
      if (key === "verticalGap" && scope !== "sameColumn") continue
      add(key, 0)
    }
    return { total: 0, items }
  }
  const tailLast = tail.lines[tail.lines.length - 1]!
  const headFirst = head.lines[0]!
  const headText = headFirst.text.trimStart()
  const W = TAIL_HEAD_WEIGHTS

  // ① 纵向间隙：同栏按"尾段底边 ↔ 头段顶边"的距离分档。
  //    跨栏/跨页没有可比的纵向量（基线节奏暂未建模）：常数项无判别力，
  //    固定 0 不占分（跨场景满分 70），宽严交由其余六项 + 阈值 49 控制。
  if (scope === "sameColumn") {
    const lh = Math.max(tailLast.h, headFirst.h, 1)
    const gap = Math.max(tail.y - (head.y + head.h), 0) / lh
    const s =
      gap < 0.5
        ? W.verticalGap
        : gap < 1.2
          ? W.verticalGap * (2 / 3)
          : gap < 2
            ? W.verticalGap / 3
            : 0
    add("verticalGap", s)
  }

  // ⑥ 尾行顶满：连续衰减——刚好贴右缘给满分，空隙越大越接近 0
  const tailRightGap = blockRight(tail.lines) - (tailLast.x + tailLast.w)
  add("tailFull", Math.max(1 - tailRightGap / Math.max(tailLast.h, 1), 0) * W.tailFull)

  // ③ 头行顶格：连续衰减
  const headLeftGap = headFirst.x - blockLeft(head.lines)
  const flushAllow = Math.max(0.5 * headFirst.h, 3)
  add("headFlush", Math.max(1 - headLeftGap / flushAllow, 0) * W.headFlush)

  // ⑥ 宽度接近：连续衰减 max(1 − |Δw|/较窄宽, 0)（ratio 形态）
  const narrower = Math.max(Math.min(tail.w, head.w), 1)
  add("widthNear", Math.max(1 - Math.abs(tail.w - head.w) / narrower, 0) * W.widthNear)

  // ④ 首字符寻常（行型替身）
  add(
    "headPlainStart",
    headText !== "" &&
      !/^\d/.test(headText) &&
      !BULLET_RE.test(headText) &&
      !/^[A-Z]/.test(headText)
      ? W.headPlainStart
      : 0,
  )

  // ⑤ 尾行无句末标点：命中句末表 = 0 分（跳过该奖励，而非一票否决）
  add("tailNoSentenceEnd", !tailHasSentenceEnd(tail) ? W.tailNoSentenceEnd : 0)

  // ⑦ 尾行停顿标点：话没说完，倾向续
  add("tailPauseEnd", PAUSE_RE.test(tailLast.text.trimEnd()) ? W.tailPauseEnd : 0)

  return { total: items.reduce((a, i) => a + i.score, 0), items }
}

/** 尾↔头打分（七项并行累加）。只算分不决策，阈值与作用域由调用方注入。
 *  坐标系为 y-up：tail 是前一块的末段（在上，y 大）、head 是后一块的首段（在下，y 小）。
 *  权重表见 TAIL_HEAD_WEIGHTS；满分 = TAIL_HEAD_FULL_SCORE。 */
export function scoreTailHead(
  tail: MergeSide,
  head: MergeSide,
  scope: TailHeadScope = "sameColumn",
): number {
  return scoreTailHeadBreakdown(tail, head, scope).total
}

export interface ParaPartRef {
  block: AssignedBlock
  paraIdx: number
  text: string
  blockId?: string
}
export interface MergeGroup {
  parts: ParaPartRef[]
  /** 组内每次成功合并的打分明细（链式合并可能有多条） */
  decisions: PairDecision[]
}

/** 一次相邻对判定的完整记录（成功与失败都记），供配对面板展示逐项得分 */
export interface PairDecision {
  tailBlock: AssignedBlock
  headBlock: AssignedBlock
  tailText: string
  headText: string
  /** 尾段/头段所在页码（1 起）：配对面板标注"第几页"用，扁平序列里天然带页信息 */
  tailPage: number
  headPage: number
  crossPage: boolean
  /** true = 同栏相邻，筛子直接不判（score 仍算出供参考） */
  sameColumn: boolean
  hardStop: boolean
  breakdown: ScoreBreakdown
  threshold: number
  merged: boolean
}

/** 阅读序节点：除 abandon（skip）外的全部【有框】块——translate + keep（docling 口径：
 *  图/表/公式/题注占位参与排序，keep 块进 R3 挡道检查，"被图隔开的上下正文块"不再直连；
 *  显示与编号层只取 plain text + title，keep 块在序列里只占位不显示编号）。
 *  orphan 碎片块（region 为 null）不参与。keep 块 paras 为空数组，故不能要求 paras.length > 0 */
export function isOrderNode(b: AssignedBlock): boolean {
  return b.behavior !== "skip" && b.region !== null
}

/** 配对白名单：只有 plain text 的 translate 块参与合并（标题/图注不参与同段合并） */
export function isMergeCandidate(b: AssignedBlock): boolean {
  return b.behavior === "translate" && b.region?.className === "plain text" && b.paras.length > 0
}

/** 块的 x 包络 / 顶边（均取块内全部段落） */
function blockSpan(b: AssignedBlock): [number, number] {
  return [Math.min(...b.paras.map((p) => p.x)), Math.max(...b.paras.map((p) => p.x + p.w))]
}
function blockTop(b: AssignedBlock): number {
  return Math.max(...b.paras.map((p) => p.y + p.h))
}

/** 统一矩形（y-up）：x1<x2，y1=底、y2=顶 */
interface ScanRect {
  x1: number
  x2: number
  y1: number
  y2: number
}

const blockRect = (b: AssignedBlock): ScanRect => {
  const [x1, x2] = blockSpan(b)
  return { x1, x2, y1: Math.min(...b.paras.map((p) => p.y)), y2: blockTop(b) }
}
const regionRect = (r: NonNullable<AssignedBlock["region"]>): ScanRect => ({
  x1: Math.min(r.x1, r.x2),
  x2: Math.max(r.x1, r.x2),
  y1: Math.min(r.y1, r.y2),
  y2: Math.max(r.y1, r.y2),
})
const tailParaOf = (b: AssignedBlock) => b.paras.reduce((a, c) => (c.y < a.y ? c : a))
const headParaOf = (b: AssignedBlock) => b.paras.reduce((a, c) => (c.y > a.y ? c : a))
const paraIdxOf = (b: AssignedBlock, p: Paragraph) => b.paras.indexOf(p)

/** D 配对阈值：跨栏、跨页六项满分 70。 */
export const WALK_TAIL_HEAD_THRESHOLD = 49

/** 块矩形：YOLO 原框；孤儿块（region 为 null）退回段落包络 */
function sieveRect(b: AssignedBlock): ScanRect {
  if (b.region) return regionRect(b.region)
  return blockRect(b)
}

/** 句末硬停（docling 式传播控制，predict_merges 的 [a-z,\-] 尾字符测试同源）：
 *  尾行以句末标点收尾 → 链强制断，不许靠其它打分项续命。段落边界几乎必然命中 → 误合链在这里被截断 */
export const CHAIN_STOP_RE = /[.!?。！？]["”’」』）)》】\]]*$/

/** 扁平合并的序列项：正文候选块 + 所在页码（筛子只对同页对生效；跨页对无"栏"概念，直接判） */
export interface FlatItem {
  block: AssignedBlock
  page: number
}

/** planFlatMerges 的返回：合并组 + 全部相邻对判定记录（成功/失败/同栏不判都记） */
export interface PlanFlatMergesResult {
  groups: MergeGroup[]
  decisions: PairDecision[]
}

/** 扁平正文序列合并：全部页的正文候选块拼成一条序列，相邻候选对两两判定——
 *  跨页接续在这条序列里天然相邻，不再需要挂起/占用检查（docling 同构：页边界不可见）。
 *  - 几何筛子只对同页对生效：x 压到（同栏）不判；跨页对直接进打分；
 *  - 句末硬停：尾行以句末标点收尾 → 不合并（链断）；
 *  - 跨栏对过六项打分 ≥ 阈值即合并；打分走 scope="crossColumn" 路径（纵向间隙固定 0）；
 *  - 标题/图注等非正文块不参与配对、也不打断链（正文块隔标题仍可合并）。
 *  已知取舍：同栏里被 YOLO 切成两个框的一段话不再合并（暂缓，见同栏条件判讨论）。
 *  副作用：组内段标记 soloCluster = true
 *  返回值附带 decisions：每对的成功/失败判定及逐项得分（配对面板展示用）。 */
export function planFlatMerges(flat: FlatItem[]): PlanFlatMergesResult {
  const threshold = WALK_TAIL_HEAD_THRESHOLD
  const groups: MergeGroup[] = []
  const decisions: PairDecision[] = []
  let cur: {
    parts: ParaPartRef[]
    decisions: PairDecision[]
    tail: Paragraph
    tailBlock: AssignedBlock
  } | null = null
  let prev: FlatItem | null = null
  for (const item of flat) {
    // 只取正文候选配对：标题/图注不参与、也不打断链（正文块隔标题仍可合并）
    if (!isMergeCandidate(item.block)) continue
    const B = item.block
    if (prev !== null) {
      const tail: Paragraph = cur ? cur.tail : tailParaOf(prev.block)
      const tailBlock: AssignedBlock = cur ? cur.tailBlock : prev.block
      const head = headParaOf(B)
      // 句末硬停：尾行以句末标点收尾 → 链断
      const tailLast = tail.lines[tail.lines.length - 1]
      const hardStop = tailLast !== undefined && CHAIN_STOP_RE.test(tailLast.text.trimEnd())
      // 几何筛子：仅同页对生效——x 压到 = 同栏 → 不判；跨页对无栏概念，直接判
      let sameColumn = false
      if (prev.page === item.page) {
        const ra = sieveRect(tailBlock)
        const rb = sieveRect(B)
        sameColumn = !(ra.x2 <= rb.x1 || rb.x2 <= ra.x1)
      }
      const breakdown = scoreTailHeadBreakdown(tail, head, "crossColumn")
      const merged = !hardStop && !sameColumn && breakdown.total >= threshold
      const decision: PairDecision = {
        tailBlock,
        headBlock: B,
        tailText: tail.text,
        headText: head.text,
        tailPage: prev.page,
        headPage: item.page,
        crossPage: prev.page !== item.page,
        sameColumn,
        hardStop,
        breakdown,
        threshold,
        merged,
      }
      decisions.push(decision)
      if (merged) {
        if (!cur)
          cur = {
            parts: [{ block: tailBlock, paraIdx: paraIdxOf(tailBlock, tail), text: tail.text }],
            decisions: [],
            tail,
            tailBlock,
          }
        cur.decisions.push(decision)
        cur.parts.push({ block: B, paraIdx: paraIdxOf(B, head), text: head.text })
        if (head !== tailParaOf(B)) {
          // 护栏：入组的是 B 的头段，若 B 还有后续段，续链会越过中间段 → 链在此收组
          groups.push({ parts: cur.parts, decisions: cur.decisions })
          cur = null
        } else {
          cur.tail = tailParaOf(B)
          cur.tailBlock = B
        }
      } else if (cur) {
        groups.push({ parts: cur.parts, decisions: cur.decisions })
        cur = null
      }
    }
    prev = item
  }
  if (cur) groups.push({ parts: cur.parts, decisions: cur.decisions })
  for (const g of groups) for (const p of g.parts) p.block.paras[p.paraIdx]!.soloCluster = true
  return { groups, decisions }
}
