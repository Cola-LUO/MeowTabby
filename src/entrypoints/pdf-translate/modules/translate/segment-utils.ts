/** %% 分段约定的连接/拆分工具（自 web_pdf_trans 的 llm_trans.ts 逐字提取，
 *  原文件的网络客户端部分不随合拢携带）。 */

import type { DocumentUnit } from "@/modules/pdf-core/document-flow"

export const BATCH_SEPARATOR = "%%"
export const BATCH_SEPARATOR_LINE_PATTERN = /\r?\n[ \t]*%%[ \t]*\r?\n/

/** 框内段落用独立行 %% 连接（MeowTabby BATCH_SEPARATOR 约定） */
export function joinSegments(texts: string[]): string {
  return texts.join(`\n\n${BATCH_SEPARATOR}\n\n`)
}

/** 标题类块（area className = "title"）：**整块一并送翻，不插 %% 分段标识**。
 *  标题是一个整体——被 %% 拆成"每行一段"分别翻译后，各行的语序/冠词会各自独立，
 *  拼回来读不通（实测 3 行标题被拆成 3 条请求）；这里直接以空格拼成一条。
 *  返回文本也不再按 %% 拆段，整条落进标题块自己的盒子。 */
export function joinPlain(texts: string[]): string {
  return texts
    .map((t) => t.trim())
    .filter((t) => t !== "")
    .join(" ")
}

/** 产品与验证器共用的实际送翻字符串。 */
export function requestTextForUnit(unit: DocumentUnit): string {
  const texts = unit.parts.map((part) => part.paragraph.text)
  return unit.kind === "title" || unit.kind === "group" ? joinPlain(texts) : joinSegments(texts)
}

/** 宽松分隔符：`%%` 出现在任意位置（行内、或前后换行数不足）都算分段。
 *  模型不总守"独占一行"的写法；严格规则会把本该切开的段落并成一段。 */
const BATCH_SEPARATOR_LOOSE = /[ \t]*%%[ \t]*\r?\n?/g

/** 把模型返回按 %% 拆回段落数组。
 *  先按严格规则（独占一行）切；若切出的段数少于"%% 出现次数 + 1"，说明有 %% 没被识别
 *  （模型写成了行内或换行数不足），再用宽松规则重切 —— 以模型给出的分隔符**数量**为准。 */
export function splitSegments(result: string): string[] {
  const strict = result
    .trim()
    .split(BATCH_SEPARATOR_LINE_PATTERN)
    .map((t) => t.trim())
  const count = (result.match(/%%/g) ?? []).length
  if (strict.length >= count + 1) return strict
  return result
    .split(BATCH_SEPARATOR_LOOSE)
    .map((t) => t.trim())
    .filter((t) => t !== "")
}
