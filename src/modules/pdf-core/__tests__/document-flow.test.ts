import type { AssignedBlock, Paragraph } from "../assign/assign"
import type { PageAnalysis } from "../pipeline"
import { describe, expect, it } from "vitest"
import { createDocumentFlow, type DocumentUnit } from "../document-flow"

function paragraph(text: string, x = 40, y = 650): Paragraph {
  return {
    text,
    x,
    y,
    w: 200,
    h: 24,
    fontSize: 10,
    lineCount: 2,
    lines: [
      { x, w: 200, h: 10, text: text + " line" },
      { x, w: 200, h: 10, text },
    ],
  }
}
function block(paras: Paragraph[], className = "plain text"): AssignedBlock {
  return {
    region: {
      x1: paras[0]!.x,
      x2: paras[0]!.x + 200,
      y1: 600,
      y2: 720,
      className,
      behavior: "translate",
      conf: 0.9,
    },
    behavior: "translate",
    paras,
    minOrder: 0,
  }
}
function page(index: number, blocks: AssignedBlock[]): PageAnalysis {
  return {
    index,
    cssW: 612,
    cssH: 792,
    pageWu: 612,
    pageHu: 792,
    rotate: 0,
    items: [],
    regions: [],
    regionsUp: [],
    regionsDown: [],
    blocks,
    keepUp: [],
    order: { seq: blocks, placed: blocks.length, total: blocks.length },
  }
}
const texts = (units: DocumentUnit[]) => units.map((u) => u.parts.map((p) => p.paragraph.text))

describe("文档按页推进与D末尾接续", () => {
  it("普通块逐段送翻，标题仍作为整体", () => {
    const flow = createDocumentFlow()
    const update = flow.push(
      page(1, [
        block([paragraph("First."), paragraph("Second.", 40, 600)]),
        block([paragraph("Title A", 40, 550), paragraph("Title B", 40, 520)], "title"),
      ]),
    )
    expect(texts(update.ready)).toEqual([["First."], ["Second."], ["Title A", "Title B"]])
  })
  it("先提交确定前文，保留可能接续的最后一段", () => {
    const flow = createDocumentFlow()
    const update = flow.push(
      page(1, [block([paragraph("Done."), paragraph("continued", 40, 600)])]),
    )
    expect(texts(update.ready)).toEqual([["Done."]])
    expect(update.pending.map((p) => p.paragraph.text)).toEqual(["continued"])
  })
  it("跨两页只送一个合并组，前文不重复送出", () => {
    const flow = createDocumentFlow()
    expect(flow.push(page(1, [block([paragraph("continued")])])).ready).toEqual([])
    const update = flow.push(page(2, [block([paragraph("ends.")])]))
    expect(texts(update.ready)).toEqual([["continued", "ends."]])
    expect(update.ready[0]!.kind).toBe("group")
    expect(update.ready[0]!.parts.map((p) => p.pageIndex)).toEqual([1, 2])
    expect(flow.finish().ready).toEqual([])
  })
  it("跨三页接续时后面的标题不能越过等待组", () => {
    const flow = createDocumentFlow()
    flow.push(page(1, [block([paragraph("continued")])]))
    const middle = flow.push(
      page(2, [block([paragraph("still continuing")]), block([paragraph("A title")], "title")]),
    )
    expect(middle.ready).toEqual([])
    const end = flow.push(page(3, [block([paragraph("ends.")])]))
    expect(texts(end.ready)).toEqual([["continued", "still continuing", "ends."], ["A title"]])
  })
  it("后续页不合并时先释放上页，再发本页", () => {
    const flow = createDocumentFlow()
    flow.push(page(1, [block([paragraph("continued")])]))
    const next = block([paragraph("ends.")])
    next.paras[0]!.fontSize = 30
    expect(texts(flow.push(page(2, [next])).ready)).toEqual([["continued"], ["ends."]])
  })
  it("文件结束释放最后的等待组，重复结束不重复提交", () => {
    const flow = createDocumentFlow()
    flow.push(page(1, [block([paragraph("continued")])]))
    expect(texts(flow.finish().ready)).toEqual([["continued"]])
    expect(flow.finish().ready).toEqual([])
  })
  it("拒绝跳页，出错后不能跨越缺失页继续送翻", () => {
    const flow = createDocumentFlow()
    expect(() => flow.push(page(2, []))).toThrow(/第.*1.*页/)
    expect(flow.push(page(1, [block([paragraph("Done.")])])).ready).toHaveLength(1)
    expect(() => flow.push(page(3, []))).toThrow(/第.*2.*页/)
  })
  it("排序未完成的页不能作为正常页提交", () => {
    const flow = createDocumentFlow()
    const p = page(1, [block([paragraph("Done.")])])
    p.order.placed = 0
    expect(() => flow.push(p)).toThrow(/阅读序/)
  })
  it("空白页不擅自断开D原有跨页配对", () => {
    const flow = createDocumentFlow()
    flow.push(page(1, [block([paragraph("continued")])]))
    expect(flow.push(page(2, [])).ready).toEqual([])
    expect(texts(flow.push(page(3, [block([paragraph("ends.")])])).ready)).toEqual([
      ["continued", "ends."],
    ])
  })
  it("多段块的首段接前页，尾段独立等待，不能整块提前送翻", () => {
    const flow = createDocumentFlow()
    flow.push(page(1, [block([paragraph("continued")])]))
    const update = flow.push(
      page(2, [block([paragraph("ends."), paragraph("new continuation", 40, 600)])]),
    )
    expect(texts(update.ready)).toEqual([["continued", "ends."]])
    expect(update.pending.map((p) => p.paragraph.text)).toEqual(["new continuation"])
  })
  it("同页跨栏组各自保持原页与段落位置", () => {
    const flow = createDocumentFlow()
    const update = flow.push(
      page(1, [block([paragraph("continued", 40)]), block([paragraph("ends.", 330)])]),
    )
    expect(texts(update.ready)).toEqual([["continued", "ends."]])
    expect(update.ready[0]!.parts.map((p) => p.paragraph.x)).toEqual([40, 330])
  })
})

describe("人工更正正文身份", () => {
  it("其它保留排序和独立翻译，只重交变化的完整合并组，支持恢复", () => {
    const flow = createDocumentFlow()
    const a = block([paragraph("continued")])
    const b = block([paragraph("caption.")])
    const c = block([paragraph("ends.")])
    const unrelated = block([paragraph("Unchanged.")])
    flow.push(page(1, [unrelated, a]))
    flow.push(page(2, [b]))
    flow.push(page(3, [c]))
    flow.finish()
    b.bodyRole = "other"
    const update = flow.replan()
    expect(texts(update.ready)).toEqual([["continued", "ends."], ["caption."]])
    expect(update.invalidated.map((u) => u.parts.map((p) => p.paragraph.text))).toEqual([
      ["continued", "caption."],
      ["ends."],
    ])
    expect(flow.replan().ready).toEqual([])
    expect(b.region?.className).toBe("plain text")
    b.bodyRole = "body"
    expect(texts(flow.replan().ready)).toEqual([["continued", "caption."], ["ends."]])
  })
  it("非正文独立块更正不重复提交，原图注可加入正文，后续页采用最新身份", () => {
    const flow = createDocumentFlow()
    const a = block([paragraph("continued")])
    const caption = block([paragraph("caption")], "figure_caption")
    flow.push(page(1, [a]))
    flow.push(page(2, [caption]))
    caption.bodyRole = "body"
    expect(flow.replan().ready).toEqual([])
    expect(texts(flow.push(page(3, [block([paragraph("ends.")])])).ready)).toEqual([
      ["continued", "caption", "ends."],
    ])
    const done = block([paragraph("Done.")])
    const independent = createDocumentFlow()
    independent.push(page(1, [done]))
    done.bodyRole = "other"
    expect(independent.replan().ready).toEqual([])
  })
})

it("长合并链更正更新完整新旧组", () => {
  const flow = createDocumentFlow()
  const blocks = ["a", "caption.", "c", "d", "ends."].map((t) => block([paragraph(t)]))
  blocks.forEach((b, i) => flow.push(page(i + 1, [b])))
  flow.finish()
  blocks[1]!.bodyRole = "other"
  const update = flow.replan()
  expect(texts(update.ready)).toEqual([["a", "c", "d", "ends."], ["caption."]])
  expect(texts(update.invalidated)).toEqual([
    ["a", "caption."],
    ["c", "d", "ends."],
  ])
})

it("人工设为正文的多段标题按原共用框接续，全部原段都在组里", () => {
  const flow = createDocumentFlow()
  flow.push(page(1, [block([paragraph("continued")])]))
  const title = block([paragraph("title one"), paragraph("title two", 40, 600)], "title")
  title.bodyRole = "body"
  flow.push(page(2, [title]))
  const update = flow.push(page(3, [block([paragraph("ends.")])]))
  expect(texts(update.ready)).toEqual([["continued", "title one", "title two", "ends."]])
})

it("处理中更正导致等待边界前移，分组未变的已译内容仍保留", () => {
  const flow = createDocumentFlow()
  const a = block([paragraph("continued")])
  const b = block([paragraph("caption.")])
  b.paras[0]!.fontSize = 30
  const other = block([paragraph("another caption.")], "figure_caption")
  flow.push(page(1, [a]))
  expect(texts(flow.push(page(2, [b, other])).ready)).toEqual([
    ["continued"],
    ["caption."],
    ["another caption."],
  ])
  b.bodyRole = "other"
  const update = flow.replan()
  expect(update.ready).toEqual([])
  expect(update.invalidated).toEqual([])
  const next = flow.push(page(3, [block([paragraph("ends.")])]))
  expect(texts(next.ready)).toEqual([["continued", "ends."]])
  expect(texts(next.invalidated)).toEqual([["continued"]])
})
