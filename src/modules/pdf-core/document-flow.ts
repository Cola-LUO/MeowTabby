import type { AssignedBlock, Paragraph } from "./assign/assign"
import type { PairDecision } from "./assign/cross-merge"
import type { PageAnalysis } from "./pipeline"
import { rendersText } from "./assign/assign"
import { CHAIN_STOP_RE, isMergeCandidate, planFlatMerges } from "./assign/cross-merge"

/** 标识属于本轮分析，回填时不依赖视图创建顺序。 */
export interface DocumentPart {
  id: string
  pageIndex: number
  blockId: string
  paraIdx: number
  block: AssignedBlock
  paragraph: Paragraph
}
export interface DocumentUnit {
  id: string
  kind: "view" | "title" | "group"
  parts: DocumentPart[]
}
export interface DocumentGroup {
  parts: DocumentPart[]
  decisions: PairDecision[]
}
export interface FlowUpdate {
  ready: DocumentUnit[]
  /** 仍待提交的成员，包括接续组之后被顺序屏障挡住的内容。 */
  pending: DocumentPart[]
  groups: DocumentGroup[]
  decisions: PairDecision[]
}

export function createDocumentFlow() {
  const pages: PageAnalysis[] = []
  const submitted = new Set<string>()
  let ended = false

  const collect = (complete: boolean): FlowUpdate => {
    const parts: DocumentPart[] = []
    const byBlock = new Map<AssignedBlock, DocumentPart[]>()
    const flat: Array<{ block: AssignedBlock; page: number }> = []
    for (const page of pages) {
      // 无框段不进入阅读序图，仍保留独立翻译资格。
      const ordered = new Set(page.order.seq)
      const blocks = [...page.order.seq, ...page.blocks.filter((b) => !ordered.has(b))]
      for (const block of blocks) {
        if (ordered.has(block)) flat.push({ block, page: page.index })
        if (!rendersText(block)) continue
        const blockId = `b${page.blocks.indexOf(block)}`
        const refs = block.paras.map((paragraph, paraIdx) => ({
          id: `p${page.index}:${blockId}:s${paraIdx}`,
          pageIndex: page.index,
          blockId,
          paraIdx,
          block,
          paragraph,
        }))
        byBlock.set(block, refs)
        parts.push(...refs)
      }
    }
    const planned = planFlatMerges(flat)
    const groups: DocumentGroup[] = planned.groups.map((g) => ({
      parts: g.parts.map((p) => byBlock.get(p.block)![p.paraIdx]!),
      decisions: g.decisions,
    }))
    const groupOf = new Map<string, DocumentGroup>()
    for (const group of groups) for (const part of group.parts) groupOf.set(part.id, group)

    // 已读前缀唯一可能变化的是最后正文块的末段及包含它的接续组。
    let boundary = parts.length
    if (!complete) {
      const last = flat.filter((f) => isMergeCandidate(f.block)).at(-1)
      const tail =
        last && byBlock.get(last.block)?.reduce((a, b) => (b.paragraph.y < a.paragraph.y ? b : a))
      if (tail) {
        const line = tail.paragraph.lines.at(-1)
        if (line && !CHAIN_STOP_RE.test(line.text.trimEnd())) {
          const first = groupOf.get(tail.id)?.parts[0] ?? tail
          boundary = parts.findIndex((p) => p.id === first.id)
        }
      }
    }

    const ready: DocumentUnit[] = []
    for (let i = 0; i < boundary; i++) {
      const part = parts[i]!
      if (submitted.has(part.id)) continue
      const group = groupOf.get(part.id)
      if (group) {
        // 组按首成员的阅读位置提交，各成员的原页码和矩形不变。
        if (group.parts[0]!.id !== part.id) continue
        ready.push({
          id: group.parts.map((p) => p.id).join("|"),
          kind: "group",
          parts: group.parts,
        })
        for (const member of group.parts) submitted.add(member.id)
        continue
      }
      const kind = part.block.region?.className === "title" ? "title" : "view"
      const previous = ready.at(-1)
      if (
        kind === "title" &&
        previous?.kind === kind &&
        previous.parts.at(-1)?.block === part.block
      ) {
        previous.parts.push(part)
        previous.id += `|${part.id}`
      } else ready.push({ id: part.id, kind, parts: [part] })
      submitted.add(part.id)
    }
    return {
      ready,
      pending: parts.filter((p) => !submitted.has(p.id)),
      groups,
      decisions: planned.decisions,
    }
  }

  return {
    push(page: PageAnalysis): FlowUpdate {
      if (ended) throw new Error("文档已经结束，不能继续加入页面")
      if (page.index !== pages.length + 1) throw new Error(`必须先处理第 ${pages.length + 1} 页`)
      if (page.order.placed !== page.order.total) throw new Error(`第 ${page.index} 页阅读序未完成`)
      pages.push(page)
      return collect(false)
    },
    finish(): FlowUpdate {
      ended = true
      return collect(true)
    },
  }
}
