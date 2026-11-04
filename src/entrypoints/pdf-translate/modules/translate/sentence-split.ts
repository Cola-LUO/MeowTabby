/** 译文按句边界切分（spec 第 3 节）。
 *  中文句末符无条件成句；英文句点 "." 仅在"空白 + 实词（大写开头后接 ≥2 小写）"后成句
 *  ——防 Fig. 1 / 3.57% / e.g. 误切；英文 ! ? 语义无歧义，无条件成句。
 *  句末符后的引号/括号并入前句。 */

const _CN_END = /[。！？；…]["”’」』）)》】\]]*/
const EN_WORD_START = /\s+[A-Z][a-z]{2,}/y // 粘滞匹配：句末符后必须紧跟这个才算英文句末

export function splitBySentences(translated: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < translated.length; i++) {
    const ch = translated[i]!
    if (!".!?。！？；…".includes(ch)) continue
    let end = i + 1
    // 后置引号/括号并入
    while (end < translated.length && /["”’」』）)》】\]]/.test(translated[end]!)) end++
    if ("。！？；…!?".includes(ch)) {
      push(end)
      i = end - 1
      continue
    }
    // 英文 "."：需 空白 + [A-Z][a-z]{2,}（或已到结尾）
    if (end >= translated.length) {
      push(end)
      i = end - 1
      continue
    }
    EN_WORD_START.lastIndex = end
    if (EN_WORD_START.test(translated)) {
      push(end)
      i = end - 1
    }
  }
  function push(end: number): void {
    const piece = translated.slice(start, end).trim()
    if (piece !== "") out.push(piece)
    start = end
  }
  if (start < translated.length) {
    const rest = translated.slice(start).trim()
    if (rest !== "") out.push(rest)
  }
  return out
}

/** 按份额贪心装配：切在离累计比例最近的句边界；单句退化 → 字符硬切。不丢字 */
export function splitByRatio(translated: string, shares: number[]): string[] {
  const sentences = splitBySentences(translated)
  const out: string[] = shares.map(() => "")
  if (sentences.length === 0) return shares.map(() => "")
  if (sentences.length < shares.length) {
    // 退化：字符硬切
    let pos = 0
    for (let k = 0; k < shares.length; k++) {
      const take =
        k === shares.length - 1
          ? translated.length - pos
          : Math.round(translated.length * shares[k]!)
      out[k] = translated.slice(pos, pos + take)
      pos += take
    }
    return out
  }
  const total = translated.length
  let acc = 0 // 已消耗句子的字符数
  let si = 0
  for (let k = 0; k < shares.length; k++) {
    const target =
      k === shares.length - 1 ? total : total * shares.slice(0, k + 1).reduce((a, b) => a + b, 0)
    let piece = ""
    while (si < sentences.length) {
      const s = sentences[si]!
      if (k < shares.length - 1 && acc + piece.length + s.length > target && piece !== "") break
      piece += (piece ? "" : "") + s
      si++
      if (k < shares.length - 1 && acc + piece.length >= target) break
    }
    acc += piece.length
    out[k] = piece
  }
  return out
}
