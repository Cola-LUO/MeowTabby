/** 行高自适应（2026-09-17）。
 *
 *  解决的问题：中文译文普遍比英文短，白盒却必须盖住整段原文（右页 canvas 是原页位图），
 *  结果盒内留大片空白。办法是把行高按"目标高 / 内容高"的比例拉开，让内容在垂直方向填满。
 *
 *  三条规则：
 *  ① 只增不减（只做加法，全库无缩行高路径）；
 *  ② 增量分档：n < 0.1 不动；n < 0.3 以 0.1 步长递增；否则候选跳测；
 *  ③ 护栏 n < 50（防"2 行译文撑 60 行框"的荒谬行距）。
 *
 *  本函数不碰字号、不碰盒高，只回答"行高该是多少"；字号与盒高由 cluster-layout.ts 负责。 */

/** 步长 0.1（行高倍数的粒度，不是像素） */
export const LH_STEP = 0.1
/** 小/大增量分界：小于它走慢速步进，大于等于它走跳测 */
export const LH_JUMP_LIMIT = 0.3
/** 护栏：需要的增量达到它就不拉了 */
export const LH_INCREASE_CAP = 50
/** "增量太小就不动"阈值 */
export const LH_MIN_INCREASE = 0.1

export interface LineHeightFitInput {
  /** 当前档位下、当前行高（base）时的内容高 */
  contentHeight: number
  /** 要填满的目标高（= 原位高） */
  targetHeight: number
  /** 折行行数（1 → 不调行高） */
  lineCount: number
  baseLineHeight: number
  /** 测量函数：给定行高倍数返回内容高（求解器注入，测试用例注入固定模型） */
  measure: (lineHeight: number) => number
}

export interface LineHeightFit {
  lineHeight: number
  increase: number
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function fitLineHeight(input: LineHeightFitInput): LineHeightFit {
  const { contentHeight, targetHeight, lineCount, baseLineHeight: base, measure } = input
  // 单行不调。单行拉行高只会让文字飘在框中，视觉更差
  if (lineCount <= 1) return { lineHeight: base, increase: 0 }
  if (!(contentHeight > 0) || !(targetHeight > 0)) return { lineHeight: base, increase: 0 }

  const n = (targetHeight / contentHeight) * base - base
  if (n < LH_MIN_INCREASE || n >= LH_INCREASE_CAP) return { lineHeight: base, increase: 0 }

  const keep = (inc: number): LineHeightFit =>
    inc > 0 ? { lineHeight: round2(base + inc), increase: inc } : { lineHeight: base, increase: 0 }

  if (n < LH_JUMP_LIMIT) {
    // 小增量：从 0 起按步长递增，取最后一个"仍不超目标高"的增量（超了就退回上一档）
    let best = 0
    for (let inc = LH_STEP; inc <= n + LH_STEP; inc = round1(inc + LH_STEP)) {
      if (measure(base + inc) > targetHeight) break
      best = inc
    }
    return keep(best)
  }

  // 大增量：候选 [0, n-0.1, n, n+0.1] 升序，取"最后一个仍装得下"的。
  // （全失败时退回 0 = 不拉。）
  const cands = [0, round1(n - LH_STEP), round1(n), round1(n + LH_STEP)]
    .filter((v) => v > 0)
    .sort((a, b) => a - b)
  let best = 0
  for (const inc of cands) {
    if (measure(base + inc) > targetHeight) break
    best = inc
  }
  return keep(best)
}
