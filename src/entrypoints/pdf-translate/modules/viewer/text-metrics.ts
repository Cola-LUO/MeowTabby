/** 文本度量（纯函数，jsdom 无布局引擎，只能估算）：字宽/折行/内容高。
 *
 *  本模块是**唯一**的估算口径来源——`fit-text.ts`（按容量分配）与 `cluster-layout.ts`（求解字号/行高）
 *  都必须走这里。两处若各留一份，会出现"装箱说装得下、求解说装不下"的自相矛盾。
 *
 *  估算偏保守（宁可提前换行），渲染后由调用方实测复核兜底。 */

/** 单行高系数：与 `viewer.css` 的 `.trans-cluster { line-height: 1.3 }` 保持一致 */
export const LINE_HEIGHT = 1.3

const CJK_RE = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/
const ASCII_RE = /[A-Za-z0-9]/

/** 单字符宽度（em 按字号折算）：CJK 1em / ASCII 0.55em / 空格 0.28em / 其他标点 0.6em */
export function charWidth(ch: string, fontSize: number): number {
  if (CJK_RE.test(ch)) return fontSize
  if (ASCII_RE.test(ch)) return fontSize * 0.55
  if (ch === " ") return fontSize * 0.28
  return fontSize * 0.6
}

/** 文本按盒宽折行需要几行（**至少 1 行**：空串/极短文本也要占一行） */
export function rowsNeeded(text: string, fontSize: number, width: number): number {
  let rows = 1
  let cur = 0
  for (const ch of text) {
    if (ch === "\n") {
      rows++
      cur = 0
      continue
    }
    const w = charWidth(ch, fontSize)
    if (cur > 0 && cur + w > width) {
      rows++
      cur = 0
    }
    cur += w
  }
  return rows
}

export interface ContentSize {
  height: number
  lines: number
}

/** 内容尺寸：height = 行数 × 字号 × 行高（与"可用行数"判据同源，保证"装得下"口径一致） */
export function contentSize(
  text: string,
  width: number,
  fontSize: number,
  lineHeight = LINE_HEIGHT,
): ContentSize {
  const lines = rowsNeeded(text, fontSize, width)
  return { height: lines * fontSize * lineHeight, lines }
}
