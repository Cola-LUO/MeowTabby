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
  /** 已被新分组替代或重新等待的旧单元。 */
  invalidated: DocumentUnit[]
  /** 仍待提交的成员，包括接续组之后被顺序屏障挡住的内容。 */
  pending: DocumentPart[]
  groups: DocumentGroup[]
  decisions: PairDecision[]
}

export function createDocumentFlow() {
  const pages: PageAnalysis[] = []
  let submitted = new Map<string, DocumentUnit>()
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
        // 标题原本共用一个显示框，人工设为正文后仍按整框接续，避免拆组回填同一框。
        let candidate = block
        if (
          block.bodyRole === "body" &&
          block.region?.className === "title" &&
          block.paras.length > 1
        ) {
          const x = Math.min(...block.paras.map((p) => p.x))
          const y = Math.min(...block.paras.map((p) => p.y))
          candidate = {
            ...block,
            paras: [
              {
                ...block.paras[0]!,
                x,
                y,
                w: Math.max(...block.paras.map((p) => p.x + p.w)) - x,
                h: Math.max(...block.paras.map((p) => p.y + p.h)) - y,
                text: block.paras.map((p) => p.text).join(" "),
                lines: block.paras.flatMap((p) => p.lines),
                lineCount: block.paras.reduce((sum, p) => sum + p.lineCount, 0),
              },
            ],
          }
        }
        if (ordered.has(block)) flat.push({ block: candidate, page: page.index })
        byBlock.set(candidate, refs)
        parts.push(...refs)
      }
    }
    for (const part of parts) delete part.paragraph.soloCluster
    const planned = planFlatMerges(flat)
    const groups: DocumentGroup[] = planned.groups.map((g) => ({
      parts: g.parts.flatMap((p) => {
        const refs = byBlock.get(p.block)!
        return p.block !== refs[0]?.block ? refs : [refs[p.paraIdx]!]
      }),
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
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const group = groupOf.get(part.id)
      if (group) {
        // 组按首成员的阅读位置提交，各成员的原页码和矩形不变。
        if (group.parts[0]!.id !== part.id) continue
        ready.push({
          id: group.parts.map((p) => p.id).join("|"),
          kind: "group",
          parts: group.parts,
        })
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
    }
    // 更正可能把等待边界前移；已译且分组未变的内容继续保留，后续真正接续时再失效。
    const beforeBoundary = new Set(parts.slice(0, boundary).map((part) => part.id))
    const available = ready.filter(
      (unit) => submitted.has(documentUnitKey(unit)) || beforeBoundary.has(unit.parts[0]!.id),
    )
    const next = new Map(available.map((unit) => [documentUnitKey(unit), unit]))
    const changed = available.filter((unit) => !submitted.has(documentUnitKey(unit)))
    const invalidated = [...submitted].filter(([key]) => !next.has(key)).map(([, unit]) => unit)
    submitted = next
    const committed = new Set(available.flatMap((unit) => unit.parts.map((part) => part.id)))
    return {
      ready: changed,
      invalidated,
      pending: parts.filter((p) => !committed.has(p.id)),
      groups,
      decisions: planned.decisions,
    }
  }

  return {
    replan(): FlowUpdate {
      return collect(ended)
    },
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

/** 原成员顺序和送翻内容相同即可复用译文与在途请求。 */
export function documentUnitKey(unit: DocumentUnit): string {
  return JSON.stringify([unit.kind, unit.parts.map((p) => [p.id, p.paragraph.text.trim()])])
}
