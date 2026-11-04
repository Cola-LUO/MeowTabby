/** 混排译文渲染：普通文字用文本节点，`$...$`/`$$...$$` 交 KaTeX。
 *  全程不拼 innerHTML（模型返回不可信）：文本走 createTextNode，
 *  公式 span 由 katex.render 填充（KaTeX macro/trust 默认关闭，自产 DOM 可信）。
 *  解析不依赖 DOM；渲染函数以参数注入（jsdom 单测与扩展环境注入同一个 katex.render）。 */
import * as katex from "katex"

export interface TextToken {
  kind: "text"
  text: string
}
export interface FormulaToken {
  kind: "formula"
  tex: string
  display: boolean
}
export type MixedToken = TextToken | FormulaToken

/** 把译文拆成 文字/公式 token 序列（单遍状态机，不依赖 DOM）：
 *  - `$$...$$` 块级公式（可跨行）
 *  - `$...$` 行内公式（内容不含换行）
 *  - `\$` 是字面美元符；未闭合/空的 `$`/`$$` 按纯文本处理 */
export function parseMixed(text: string): MixedToken[] {
  const tokens: MixedToken[] = []
  const flush = (s: string) => {
    if (s !== "") tokens.push({ kind: "text", text: s })
  }
  let buf = ""
  let i = 0
  while (i < text.length) {
    if (text.startsWith("\\$", i)) {
      buf += "$"
      i += 2
      continue
    }
    if (text.startsWith("$$", i)) {
      const end = findClose(text, i + 2)
      const body = end === -1 ? null : text.slice(i + 2, end).trim()
      if (body) {
        flush(buf)
        buf = ""
        tokens.push({ kind: "formula", tex: body, display: true })
        i = end + 2
        continue
      }
      buf += "$$"
      i += 2 // 未闭合/空内容 → 字面量
      continue
    }
    if (text[i] === "$") {
      const end = findClose(text, i + 1)
      const body = end === -1 ? null : text.slice(i + 1, end)
      if (body && !body.includes("\n") && body.trim() !== "") {
        flush(buf)
        buf = ""
        tokens.push({ kind: "formula", tex: body.trim(), display: false })
        i = end + 1
        continue
      }
      buf += "$"
      i += 1
      continue
    }
    buf += text[i]
    i += 1
  }
  flush(buf)
  return tokens
}

/** 找配对闭界符：跳过转义字符（反斜杠后一位），返回 `$` 下标或 -1 */
function findClose(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === "\\") {
      j++
      continue
    }
    if (text[j] === "$") return j
  }
  return -1
}

/** 渲染函数签名（供注入）：与 katex.render 对齐 */
export type RenderTex = (tex: string, el: HTMLElement, display: boolean) => void

/** 默认渲染：throwOnError:false，坏 LaTeX 渲染为错误串而非抛异常 */
const renderTex: RenderTex = (tex, el, display) => {
  katex.render(tex, el, { throwOnError: false, displayMode: display })
}

/** 把 token 序列写入 DOM：文本 → createTextNode，公式 → katex span；
 *  display 公式包一层块级 div（.katex-display 自带块级与居中样式）。 */
export function appendMixedText(
  el: HTMLElement,
  text: string,
  render: RenderTex = renderTex,
): void {
  for (const tok of parseMixed(text)) {
    if (tok.kind === "text") {
      el.appendChild(el.ownerDocument.createTextNode(tok.text))
      continue
    }
    const host = el.ownerDocument.createElement(tok.display ? "div" : "span")
    try {
      render(tok.tex, host, tok.display)
    } catch {
      host.textContent = tok.tex // 坏 LaTeX 兜底：宁可显示原始串，不丢内容
    }
    el.appendChild(host)
  }
}

/** fillBlockText 的混排版：段间 <br>（沿用现有约定），空段不产生 <br>。 */
export function fillMixedText(el: HTMLElement, paragraphs: string[], render?: RenderTex): void {
  const nonEmpty = paragraphs.filter((t) => t.trim() !== "")
  nonEmpty.forEach((text, i) => {
    if (i > 0) el.appendChild(el.ownerDocument.createElement("br"))
    appendMixedText(el, text, render)
  })
}

/** 从已回填的盒里读回**带段界的文本** —— `fillMixedText` 的逆操作，供排版求解器估算行数。
 *
 *  **必须走 DOM，不能用 `textContent`**：段间的 `<br>` 不产生任何文本，`textContent` 会把
 *  多个段落首尾相接成一条连续文本，行数被严重低估（实测 17 段：算成 37 行，实际 47 行）。
 *
 *  低估会连锁放大：`cluster-layout` 先缩字号（只降），再按"估算内容高"反推**行高**去填满原位高
 *  —— 行数算得越少，行高就拉得越狠（实测被拉到 2.7 倍），真实内容反而更高，
 *  最后"估算说装得下、实际溢出" → 盒子 overflow:hidden 静默把尾巴裁掉。
 *
 *  映射规则：文本节点原样；`<br>` → 换行；块级子元素（display 公式）独占整行；
 *  排版层装饰（`.linear-mask`）不属于译文，跳过。 */
export function readMixedText(el: HTMLElement): string {
  let out = ""
  const pushBreak = (): void => {
    if (out !== "" && !out.endsWith("\n")) out += "\n"
  }
  const visit = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out += child.nodeValue ?? ""
        continue
      }
      if (child.nodeType !== 1) continue
      const e = child as HTMLElement
      if (e.classList.contains("linear-mask")) continue // 排版层装饰，不是译文
      if (e.tagName === "BR") {
        out += "\n"
        continue
      }
      if (e.tagName === "DIV") {
        // 块级子元素（display 公式）：独占整行
        pushBreak()
        visit(e)
        pushBreak()
        continue
      }
      visit(e)
    }
  }
  visit(el)
  return out.trim()
}
