/** 簇盒统一求解器（2026-09-17）：三步求解（缩字号 → 拉行高 → 定盒高）的统一入口。
 *
 *  为什么需要一个统一入口：改动前"缩字号"只落在合并组（fit-text 的整组档位），普通块的字号写死在
 *  renderBlocks、行高写死在 CSS、盒高靠 min-height 自己长 —— 三类块（普通/标题/合并组）各有一套行为，
 *  谁都没回答"这个盒到底该怎么排"。本函数是唯一的答案。
 *
 *  顺序：先缩字号（只缩）→ 再拉行高（只增）→ 最后定盒高与溢出。
 *  盒高恒 ≤ availHeight：这是"不可能压住别人"的结构保证（overflow:hidden 语义）。
 *
 *  盒高允许长到内容高（上限 availHeight）——
 *  因为右页 canvas 上有英文，白盒不能收缩到内容高，能长也不能越出可用区。 */

import { fitLineHeight } from "./fit-line-height"
import { SCALE_STEPS } from "./fit-text"
import { LINE_HEIGHT, contentSize } from "./text-metrics"

export interface ClusterLayoutInput {
  text: string
  /** 盒宽（CSS px） */
  width: number
  /** 原位高（geo.h）：短译文要填满的目标 */
  minHeight: number
  /** 可用高（≥ minHeight）：容量上界；当前恒 = 原位高（targetOf 取 geo.h，不许长高） */
  availHeight: number
  /** 段落字号 × 0.9（下限 6），即 renderBlocks 写进盒的现行值 */
  baseFontSize: number
  baseLineHeight?: number
  /** 指定行高时跳过逐盒拉高；页级字距规格与溢出复核共用。 */
  lineHeight?: number
  /** 起始档位（合并组传 splitByCapacity 给出的 scale；普通块传 1）：只允许往下降 */
  startScale?: number
  /** 档位表覆盖（测试/refit 用） */
  scales?: number[]
}

export interface ClusterLayoutResult {
  scale: number
  lineHeight: number
  /** 盒高（CSS px），恒 ≤ availHeight */
  height: number
  overflow: boolean
  /** 求解后的内容高（调试/复核用） */
  contentHeight: number
}

export function solveClusterLayout(input: ClusterLayoutInput): ClusterLayoutResult {
  const { text, width, minHeight, availHeight, baseFontSize } = input
  const lh0 = input.baseLineHeight ?? LINE_HEIGHT
  const scales = input.scales ?? SCALE_STEPS
  // 可用高不得小于原位高：否则盒连自己的原段都盖不住（障碍表异常时的保守兜底）
  const avail = Math.max(availHeight, minHeight)
  const fsAt = (scale: number) => Math.max(baseFontSize * scale, 1)

  // 阶段 1：字号（只缩不放）。起始档位 = startScale 在档位表中的位置，只允许往下降
  let idx = Math.max(
    0,
    scales.findIndex((s) => s <= (input.startScale ?? 1)),
  )
  let size = contentSize(text, width, fsAt(scales[idx]!), lh0)
  while (idx < scales.length - 1 && size.height > avail) {
    idx++
    size = contentSize(text, width, fsAt(scales[idx]!), lh0)
  }
  const scale = scales[idx]!
  const fontSize = fsAt(scale)

  // 阶段 2：行高（只增不减）。只在"内容比原位高矮"时才拉 —— 目标是填满原位高，不是填满可用高
  //（填到可用高会让白盒下缘压到障碍前，视觉上白底过大）
  const fit =
    input.lineHeight !== undefined
      ? { lineHeight: input.lineHeight, increase: 0 }
      : size.height < minHeight
        ? fitLineHeight({
            contentHeight: size.height,
            targetHeight: minHeight,
            lineCount: size.lines,
            baseLineHeight: lh0,
            measure: (lh) => contentSize(text, width, fontSize, lh).height,
          })
        : { lineHeight: lh0, increase: 0 }

  // 阶段 3：盒高与溢出。overflow 时盒高锁在可用高（绝不越界），超出框的内容由 CSS 裁切
  const measured = contentSize(text, width, fontSize, fit.lineHeight)
  const overflow = measured.height > avail
  return {
    scale,
    lineHeight: fit.lineHeight,
    height: overflow ? avail : Math.max(minHeight, measured.height),
    overflow,
    contentHeight: measured.height,
  }
}
