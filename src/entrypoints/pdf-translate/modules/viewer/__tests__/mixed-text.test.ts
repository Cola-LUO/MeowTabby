/** 混排译文渲染：普通文字走文本节点，$...$ / $$...$$ 交 KaTeX。
 *  不使用 innerHTML（模型返回不可信）；坏 LaTeX 兜底为原始文本。 */
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { appendMixedText, fillMixedText, parseMixed, readMixedText } from "../mixed-text"
import { rowsNeeded } from "../text-metrics"

const katexSpans = (el: HTMLElement): HTMLElement[] =>
  [...el.querySelectorAll(".katex")] as HTMLElement[]

describe("parseMixed：把译文拆成文字/公式 token", () => {
  it("纯文字返回单 token", () => {
    expect(parseMixed("能量守恒")).toEqual([{ kind: "text", text: "能量守恒" }])
  })

  it("行内 $...$ 切出 formula token", () => {
    expect(parseMixed("其中 $E = mc^2$ 成立")).toEqual([
      { kind: "text", text: "其中 " },
      { kind: "formula", tex: "E = mc^2", display: false },
      { kind: "text", text: " 成立" },
    ])
  })

  it("$$...$$ 切出块级 formula token", () => {
    expect(parseMixed("满足\n$$x^2 + y^2 = r^2$$\n即可")).toEqual([
      { kind: "text", text: "满足\n" },
      { kind: "formula", tex: "x^2 + y^2 = r^2", display: true },
      { kind: "text", text: "\n即可" },
    ])
  })

  it("未闭合的 $ 按纯文本处理", () => {
    expect(parseMixed("价格是 $5，不便宜")).toEqual([{ kind: "text", text: "价格是 $5，不便宜" }])
  })

  it("\\$ 转义为字面美元符", () => {
    expect(parseMixed("花 $100 需 \\$5")).toEqual([{ kind: "text", text: "花 $100 需 $5" }])
  })
})

describe("appendMixedText：写入 DOM", () => {
  it("纯文字只产生文本节点", () => {
    const el = document.createElement("div")
    appendMixedText(el, "普通文字")
    expect(el.childNodes).toHaveLength(1)
    expect(el.textContent).toBe("普通文字")
    expect(katexSpans(el)).toHaveLength(0)
  })

  it("行内公式产生 katex span，前后文字保持文本节点", () => {
    const el = document.createElement("div")
    appendMixedText(el, "其中 $E = mc^2$ 成立")
    const spans = katexSpans(el)
    expect(spans).toHaveLength(1)
    expect(el.textContent).not.toContain("$")
    expect(el.textContent).toContain("其中")
    expect(el.textContent).toContain("成立")
  })

  it("display 公式渲染为 katex-display", () => {
    const el = document.createElement("div")
    appendMixedText(el, "满足 $$x^2 + y^2 = r^2$$ 即可")
    expect(el.querySelectorAll(".katex-display")).toHaveLength(1)
  })

  it("默认渲染（throwOnError:false）遇到坏 LaTeX 不抛异常", () => {
    const el = document.createElement("div")
    expect(() => appendMixedText(el, "$\\frac{1$")).not.toThrow()
  })

  it("渲染抛异常时兜底为原始 LaTeX 文本", () => {
    const el = document.createElement("div")
    appendMixedText(el, "$x^2$ 后文", () => {
      throw new Error("mock failure")
    })
    expect(el.textContent).toContain("x^2")
    expect(el.textContent).toContain("后文")
  })
})

describe("fillMixedText：多段译文（沿用 <br> 分段约定）", () => {
  it("段间 <br>，公式照常渲染", () => {
    const el = document.createElement("div")
    fillMixedText(el, ["第一段 $a+b$ 结束", "第二段"])
    expect(el.querySelectorAll("br")).toHaveLength(1)
    expect(katexSpans(el)).toHaveLength(1)
  })

  it("空段跳过", () => {
    const el = document.createElement("div")
    fillMixedText(el, ["第一段", ""])
    expect(el.querySelectorAll("br")).toHaveLength(0)
  })
})

describe("readMixedText：读回带段界的文本（排版估算口径）", () => {
  it("段间 <br> 还原成换行（textContent 看不见 <br>，会拼成一条）", () => {
    const el = document.createElement("div")
    fillMixedText(el, ["第一段", "第二段", "第三段"])
    expect(el.textContent).toBe("第一段第二段第三段")
    expect(readMixedText(el)).toBe("第一段\n第二段\n第三段")
  })

  it("行数估算不再漏掉段界：同源文本，DOM 读法比 textContent 多算段数", () => {
    const el = document.createElement("div")
    fillMixedText(el, ["甲乙丙丁戊己庚辛", "子丑寅卯辰巳午未"])
    const fs = 10
    const width = 1000 // 宽到不可能折行，行数只由段界决定
    expect(rowsNeeded(el.textContent, fs, width)).toBe(1)
    expect(rowsNeeded(readMixedText(el), fs, width)).toBe(2)
  })

  it("块级子元素（display 公式）独占整行", () => {
    const el = document.createElement("div")
    el.appendChild(el.ownerDocument.createTextNode("上文"))
    const block = el.ownerDocument.createElement("div")
    block.textContent = "公式"
    el.appendChild(block)
    el.appendChild(el.ownerDocument.createTextNode("下文"))
    expect(readMixedText(el)).toBe("上文\n公式\n下文")
  })

  it("空盒返回空串", () => {
    expect(readMixedText(document.createElement("div"))).toBe("")
  })
})
