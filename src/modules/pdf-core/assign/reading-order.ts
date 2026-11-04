import type { AssignedBlock } from "./assign"
import { isOrderNode } from "./cross-merge"

/**
 * docling 阅读序算法（连线再顺线走）的移植，只用于阅读序本身。
 * 参照实现（只读）：github克隆到本地/docling/docling/models/postprocessing/reading_order_rb.py
 * 坐标约定：y-up（b = 底边、t = 顶边），与 pdf-verify flipRegionY 后的框一致；
 * docling 的 to_bottom_left_origin 那步不适用（我们本来就是 y-up）。
 *
 * 明确不搬：页眉/正文/页脚分堆、图注/脚注归属、predict_merges（拉丁正则，中文不触发）。
 */

const EPS = 0.001

/** 参与阅读序的节点：翻译目标块（plain text 且有段落） */
interface OrderNode {
  block: AssignedBlock
  /** 页码（R5 比较器用；单页跑内恒等，保留字段与参照实现对齐） */
  page: number
  /** 内容流序号排名：本页参与块按 minOrder 排好后的下标 */
  cid: number
  /** YOLO 原框（归一后，y-up）：入口判定与走线比较器都用原框 */
  l: number
  b: number
  r: number
  t: number
}

export interface WalkReadingOrderResult {
  /** 新算法产出的阅读序列（placed 个，按走线顺序） */
  seq: AssignedBlock[]
  /** 参与排序的块总数 */
  total: number
  /** 实际排出的块数（placed < total = 有块没被走线覆盖，必须报警不许静默） */
  placed: number
}

/** 块的原框：YOLO region 归一矩形；孤儿块（region 为 null）退回段落包络 */
function nodeRect(b: AssignedBlock): { l: number; b: number; r: number; t: number } {
  const r = b.region
  if (r) {
    return {
      l: Math.min(r.x1, r.x2),
      r: Math.max(r.x1, r.x2),
      b: Math.min(r.y1, r.y2),
      t: Math.max(r.y1, r.y2),
    }
  }
  const xs = b.paras.map((p) => [p.x, p.x + p.w] as const)
  return {
    l: Math.min(...xs.map(([a]) => a)),
    r: Math.max(...xs.map(([, z]) => z)),
    b: Math.min(...b.paras.map((p) => p.y)),
    t: Math.max(...b.paras.map((p) => p.y + p.h)),
  }
}

/** 左右压到（docling overlaps_horizontally） */
const hOverlap = (aL: number, aR: number, bL: number, bR: number): boolean =>
  !(aR <= bL || bR <= aL)

/** 竖直重合度（docling overlaps_vertically_with_iou，严格大于阈值才叫同排） */
function verticalIoU(a: OrderNode, b: OrderNode): number {
  const overlap = Math.min(a.t, b.t) - Math.max(a.b, b.b)
  const union = Math.max(a.t, b.t) - Math.min(a.b, b.b)
  return union > 0 ? overlap / union : 0
}

/** R3 挡道检查：A→B 之间是否有其它框压着（返回 true = 挡道，边不建）。
 *  参照 _has_sequence_interruption；其 rtree 矩形预滤与逐 W 条件完全等价（条件蕴含矩形相交），暴力直查。 */
function hasInterruption(nodes: OrderNode[], i: number, j: number): boolean {
  const A = nodes[i]!
  const B = nodes[j]!
  for (let w = 0; w < nodes.length; w++) {
    if (w === i || w === j) continue
    const W = nodes[w]!
    if (
      (hOverlap(A.l, A.r, W.l, W.r) || hOverlap(B.l, B.r, W.l, W.r)) &&
      A.b + EPS > W.t &&
      W.b + EPS > B.t
    )
      return true
  }
  return false
}

/**
 * R2 上下线（up/dn）。lr 传入各节点的 (l,r)——原始框或 R4 撑宽后的框；
 * b/t 恒为原框。l2r/r2l 来自 R1（撑宽不重算）。
 * 步骤 (a) 去重、步骤 (c) 不去重，与参照实现逐条一致（重复项对走线无害）。
 */
function buildUdMaps(
  nodes: OrderNode[],
  lr: Array<{ l: number; r: number }>,
  l2r: Map<number, number>,
  r2l: Map<number, number>,
): { up: number[][]; dn: number[][] } {
  const n = nodes.length
  const up: number[][] = Array.from({ length: n }, () => [])
  const dn: number[][] = Array.from({ length: n }, () => [])
  for (let j = 0; j < n; j++) {
    const B = nodes[j]!
    // (a) 同排左块也算 B 的一个前驱
    if (r2l.has(j)) {
      const p = r2l.get(j)!
      if (!dn[p]!.includes(j)) dn[p]!.push(j)
      if (!up[j]!.includes(p)) up[j]!.push(p)
    }
    // (b)+(c) 竖条 (B.l-0.1, B.t, B.r+0.1, +∞) 内的候选：条件筛出与竖条相交且压左右的块，
    // 暴力全扫与 rtree 等价（一页几十块）
    for (let i = 0; i < n; i++) {
      if (i === j) continue
      const A = nodes[i]!
      const AL = lr[i]!.l
      const AR = lr[i]!.r
      // A 严格在 B 上方（A.b + eps > B.t）
      if (!(A.b + EPS > B.t)) continue
      // A 与 B 左右压到（压到即与竖条 x 区间相交）
      if (!hOverlap(AL, AR, B.l, B.r)) continue
      // R3 挡道检查
      if (hasInterruption(nodes, i, j)) continue
      // 边接到同排最右块：while (A' 在 l2r 中) A' = l2r[A']
      let a2 = i
      while (l2r.has(a2)) a2 = l2r.get(a2)!
      dn[a2]!.push(j)
      up[j]!.push(a2)
    }
  }
  return { up, dn }
}

/**
 * R1–R6 主流程（每页独立跑）。
 * 序列顺序确定：全部用数组遍历 + 稳定排序，不依赖 Map/Set 迭代序。
 */
export function walkReadingOrder(
  blocks: AssignedBlock[],
  pageW: number,
  pageNo: number,
): WalkReadingOrderResult {
  // 节点集合 + cid：除 abandon 外全部有框块（translate + keep，docling 口径），孤儿块不参与
  const cands: OrderNode[] = blocks
    .filter(isOrderNode)
    .map((block) => ({ block, page: pageNo, cid: 0, ...nodeRect(block) }))
  // cid 排名 = docling _sort_clusters(mode="id") 同款：
  // 有文本块按 minOrder（认领排他 ⇒ 全局唯一），无文本块（keep 的 paras 为空）排尾；
  // 同分/无文本按几何 (t, l) 决出确定序（y-up：t 降序 = 顶边高的在前，再按 l 升序），
  // 末位以 (r, b) 兜底保证同输入必同序。
  cands.sort((a, b) => {
    const ga = a.block.paras.length > 0 ? 0 : 1
    const gb = b.block.paras.length > 0 ? 0 : 1
    if (ga !== gb) return ga - gb
    if (ga === 0) {
      const d = a.block.minOrder - b.block.minOrder
      if (d !== 0) return d
    }
    if (b.t !== a.t) return b.t - a.t
    if (a.l !== b.l) return a.l - b.l
    if (b.r !== a.r) return b.r - a.r
    return b.b - a.b
  })
  cands.forEach((nd, i) => {
    nd.cid = i
  })
  const nodes = cands
  const n = nodes.length
  if (n === 0) return { seq: [], total: 0, placed: 0 }

  // ---- R1 同排线 l2r / r2l：cid 紧挨 + 严格在左 + 竖直重合度 > 0.8 ----
  const l2r = new Map<number, number>()
  const r2l = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const A = nodes[i]!
      const B = nodes[j]!
      if (A.cid + 1 === B.cid && A.r + EPS < B.l && verticalIoU(A, B) > 0.8) {
        l2r.set(i, j)
        r2l.set(j, i)
      }
    }
  }

  // ---- R2（原始框）→ R4 加宽 → R2（撑后框）覆盖 ----
  const origLr = nodes.map((nd) => ({ l: nd.l, r: nd.r }))
  const first = buildUdMaps(nodes, origLr, l2r, r2l)

  let up = first.up
  let dn = first.dn
  // R4 加宽重试：th = 0.155 * 页宽；独立公式每侧截到上限，其余类别超限放弃。
  // 撑完与任何其它【原始框】压到（双轴）→ 放弃保持原样。up/dn 取撑宽前的首元素。
  const th = 0.155 * pageW
  const dil = nodes.map((nd) => ({ l: nd.l, r: nd.r }))
  for (let i = 0; i < n; i++) {
    const nd = nodes[i]!
    const cappedFormula = nd.block.region?.className === "isolate_formula"
    let x0 = dil[i]!.l
    let x1 = dil[i]!.r
    let ok = true
    if (up[i]!.length > 0) {
      const U = nodes[up[i]![0]!]!
      const x0d = Math.min(x0, U.l)
      const x1d = Math.max(x1, U.r)
      if (cappedFormula) {
        x0 = Math.max(x0d, nd.l - th)
        x1 = Math.min(x1d, nd.r + th)
      } else if (x0 - x0d > th || x1d - x1 > th) ok = false
      else {
        x0 = x0d
        x1 = x1d
      }
    }
    if (ok && dn[i]!.length > 0) {
      const D = nodes[dn[i]![0]!]!
      const x0d = Math.min(x0, D.l)
      const x1d = Math.max(x1, D.r)
      if (cappedFormula) {
        x0 = Math.max(x0d, nd.l - th)
        x1 = Math.min(x1d, nd.r + th)
      } else if (x0 - x0d > th || x1d - x1 > th) ok = false
      else {
        x0 = x0d
        x1 = x1d
      }
    }
    if (!ok) continue
    const clashes = nodes.some((W, w) => {
      if (w === i) return false
      return hOverlap(x0, x1, W.l, W.r) && W.t > nd.b && nd.t > W.b
    })
    if (!clashes) {
      dil[i]!.l = x0
      dil[i]!.r = x1
    }
  }
  const second = buildUdMaps(nodes, dil, l2r, r2l)
  up = second.up
  dn = second.dn

  // ---- R5 入口与比较器（坐标用原始框）----
  const cmp = (x: number, y: number): number => {
    const X = nodes[x]!
    const Y = nodes[y]!
    if (X.page !== Y.page) return X.page - Y.page
    if (hOverlap(X.l, X.r, Y.l, Y.r)) return Y.b - X.b // b 大的在前 = 更靠上的先读
    return X.l - Y.l // l 小的在前 = 更靠左的先读
  }
  const heads: number[] = []
  for (let i = 0; i < n; i++) if (up[i]!.length === 0) heads.push(i)
  heads.sort(cmp)
  for (const inds of dn) inds.sort(cmp)

  // ---- R6 走线（迭代，不许递归）----
  const order: number[] = []
  const visited = new Array<boolean>(n).fill(false)
  const emit = (j: number) => {
    order.push(j)
    visited[j] = true
  }
  const walkUp = (j: number): number => {
    let k = j
    for (;;) {
      const inds = up[k]!
      let next = -1
      for (const ind of inds) {
        if (!visited[ind]) {
          next = ind
          break
        }
      }
      if (next < 0) return k
      k = next
    }
  }
  const walkDown = (j: number): void => {
    const stack: Array<{ inds: number[]; off: number }> = [{ inds: dn[j]!, off: 0 }]
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!
      let found = false
      for (let k = top.off; k < top.inds.length; k++) {
        const u = walkUp(top.inds[k]!)
        if (!visited[u]) {
          emit(u)
          top.off = k + 1
          stack.push({ inds: dn[u]!, off: 0 })
          found = true
          break
        }
      }
      if (!found) stack.pop()
    }
  }
  for (const j of heads) {
    if (!visited[j]) {
      emit(j)
      walkDown(j)
    }
  }

  return {
    seq: order.map((i) => nodes[i]!.block),
    total: n,
    placed: order.length,
  }
}
