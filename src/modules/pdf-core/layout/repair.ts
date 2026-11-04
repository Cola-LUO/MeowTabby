import type { PdfTextItem } from "../pdf/text-items"
import type { Region } from "./model-runner"
import { buildLines } from "../assign/assign"

/** 相邻文字项之间允许的最大间隙 */
export const ABSORB_GAP = 10
/** 每侧吸收字符数上限（逐碎片滚动判定，超限即停） */
export const MAX_ABSORB_CHARS = 25

function centerIn(item: PdfTextItem, r: Region, margin = 0): boolean {
  const cx = item.x + item.w / 2,
    cy = item.y - item.h / 2
  return cx >= r.x1 - margin && cx <= r.x2 + margin && cy >= r.y1 - margin && cy <= r.y2 + margin
}

/** 区域补框：模型框的纯几何修正（不重推理），在归属判定之前执行。
 *  ① 同行吸收：translate 区域沿同一视觉行吸收两端的无主碎片；
 *  ② 同类重叠合并：重叠过半的 translate 区域取包络。
 *  只吸"无主"item（不属于任何区域，含 keep），只横向扩，纵向不动 */
export function repairRegions(regions: Region[], items: PdfTextItem[]): Region[] {
  const result = regions.map((r) => ({ ...r }))
  if (result.length === 0) return result

  // 归属预计算：item -> 现主区域下标（-1 无主）。keep 判定沿用 KEEP_MARGIN 外扩
  const owner = new Map<PdfTextItem, number>()
  if (items.length > 0) {
    for (const it of items) {
      owner.set(
        it,
        result.findIndex((r) => centerIn(it, r, r.behavior === "keep" ? 6 : 0)),
      )
    }
  }

  // ① 同行吸收
  if (items.length > 0) {
    const lines = buildLines(items)
    for (const [ri, r] of result.entries()) {
      if (r.behavior !== "translate") continue
      for (const line of lines) {
        // 行盒与区域的纵向重叠须过半行高（同一视觉行才吸，绝不纵向扩）
        const vOverlap = Math.min(line.y, r.y2) - Math.max(line.y - line.h, r.y1)
        if (vOverlap < line.h / 2) continue
        const anchors = line.items.filter((it) => owner.get(it) === ri)
        if (anchors.length === 0) continue
        for (const side of ["left", "right"] as const) {
          let used = 0
          // 从原框或已认领文字的最外沿起步，随后逐项量相邻空白
          let edge =
            side === "left"
              ? Math.min(r.x1, ...anchors.map((it) => it.x))
              : Math.max(r.x2, ...anchors.map((it) => it.x + it.w))
          const candidates = line.items
            .filter((it) => owner.get(it) === -1)
            .filter((it) => (side === "left" ? it.x < edge : it.x + it.w > edge))
            .sort((a, b) => (side === "left" ? b.x + b.w - (a.x + a.w) : a.x - b.x))
          for (const it of candidates) {
            const gap = side === "left" ? edge - (it.x + it.w) : it.x - edge
            if (gap > ABSORB_GAP) break
            if (used + it.str.length > MAX_ABSORB_CHARS) break
            const nextX1 = side === "left" ? Math.min(r.x1, it.x - 1) : r.x1
            const nextX2 = side === "right" ? Math.max(r.x2, it.x + it.w + 1) : r.x2
            const stripX1 = side === "left" ? nextX1 : r.x2
            const stripX2 = side === "right" ? nextX2 : r.x1
            if (
              result.some(
                (other, oi) =>
                  oi !== ri &&
                  stripX1 < other.x2 &&
                  stripX2 > other.x1 &&
                  r.y1 < other.y2 &&
                  r.y2 > other.y1,
              )
            )
              break
            used += it.str.length
            r.x1 = nextX1
            r.x2 = nextX2
            edge = side === "left" ? it.x : it.x + it.w
          }
        }
      }
    }
  }

  // ② 重叠合并：重叠过半的 translate 区域取包络（消除双重消费隐患）
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i]!,
          b = result[j]!
        if (a.behavior !== "translate" || b.behavior !== "translate") continue
        const iw = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
        const ih = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
        if (iw <= 0 || ih <= 0) continue
        const areaA = (a.x2 - a.x1) * (a.y2 - a.y1),
          areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
        if (iw * ih > Math.min(areaA, areaB) * 0.5) {
          a.x1 = Math.min(a.x1, b.x1)
          a.y1 = Math.min(a.y1, b.y1)
          a.x2 = Math.max(a.x2, b.x2)
          a.y2 = Math.max(a.y2, b.y2)
          if (b.conf > a.conf) a.className = b.className
          a.conf = Math.max(a.conf, b.conf)
          result.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }
  return result
}
