/** 障碍距离：合并组"前盒"能向下吃多少空白（2026-09-16，跨栏合并组按容量分配 Task 1）。
 *
 *  背景：合并组的译文以往按原文长度占比切分，量常堆到后一个盒里，盒被内容撑高后压住下方内容。
 *  新策略要求"其余全部给前盒，前盒可向下吃到障碍前"——本模块只回答一个问题：
 *  **这个盒从自身顶边往下，最多能写多高**（= 自身高 + 到下方最近障碍的间距）。
 *
 *  口径：全程 y-up（与 `Paragraph` 一致：y = 底、h = 高；"下方" = y 减小的方向），
 *  障碍矩形可由 `regionToRect` 从 Region（x1/y1/x2/y2，同为 y-up）转换而来。
 *
 *  注意：本模块不负责"排除盒自己"——调用方组装 obstacles 时须把当前盒剔除
 *  （合并组里其余 part 的盒**必须**留在 obstacles 里，它们同样是障碍）。
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** y-up Region（layout 模型输出）→ 矩形 */
export function regionToRect(r: { x1: number; y1: number; x2: number; y2: number }): Rect {
  return { x: r.x1, y: r.y1, w: r.x2 - r.x1, h: r.y2 - r.y1 }
}

/**
 * 盒向下可吃到的总高（y-up）：
 * - 下方（上沿 ≤ 盒底）且与盒在 x 上实质重叠（重叠宽 > minOverlapX）的障碍中，取上沿最高者作为下界；
 * - 若无障碍 → 下界 = `bottom`（页面底边距，默认 0 = 页底）；
 * - 若障碍与盒**垂直重叠**（侵入盒体，如上沿高于盒底但下沿低于盒顶）→ 保守取间隙 0（不得下吃）；
 * - 与盒 x 不重叠、或整体位于盒上方的障碍一律忽略。
 */
export function availableHeightFor(
  box: Rect,
  obstacles: Rect[],
  bottom = 0,
  minOverlapX = 1,
): number {
  let gap = box.y - bottom
  const boxTop = box.y + box.h
  for (const o of obstacles) {
    const overlapX = Math.min(box.x + box.w, o.x + o.w) - Math.max(box.x, o.x)
    if (overlapX <= minOverlapX) continue
    const oTop = o.y + o.h
    if (oTop > box.y) {
      // 不在盒下方：要么整体在盒上方（忽略），要么侵入盒体（保守取 0）
      if (o.y < boxTop) gap = Math.min(gap, 0)
      continue
    }
    gap = Math.min(gap, box.y - oTop)
  }
  return box.h + Math.max(0, gap)
}
