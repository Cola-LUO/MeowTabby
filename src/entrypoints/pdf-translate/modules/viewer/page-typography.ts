import type { AssignedBlock } from "@/modules/pdf-core/assign/assign"
import { LINE_HEIGHT } from "./text-metrics"

export interface PageTypography {
  fontSizeFor: (block: AssignedBlock) => number
  lineHeightFor: (block: AssignedBlock) => number
}

function median(values: number[]): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** 本页正文共用一个字号；标题只和原文字高相近的标题共用字号。 */
export function pageTypography(
  blocks: AssignedBlock[],
  sourceLeading: number,
  titleLeadingFor: (block: AssignedBlock) => number = () => 0,
): PageTypography {
  const translated = blocks.filter((b) => b.behavior === "translate" && b.paras.length > 0)
  const bodySizes = translated
    .filter((b) => b.region?.className === "plain text")
    .flatMap((b) => b.paras.map((p) => p.fontSize))
  const bodySize = median(bodySizes)
  const titleSizes = translated
    .filter((b) => b.region?.className === "title")
    .map((b) => median(b.paras.map((p) => p.fontSize)))
  const ratio = (leading: number, fontSize: number) =>
    leading > 0 ? Math.max(LINE_HEIGHT, Math.min(leading / fontSize, 2)) : LINE_HEIGHT
  const bodyLineHeight = ratio(sourceLeading, Math.max(bodySize * 0.9, 6))
  const fontSizeFor = (block: AssignedBlock) => {
    const own = median(block.paras.map((p) => p.fontSize)) || 12
    if (block.region?.className === "plain text") return Math.max((bodySize || own) * 0.9, 6)
    if (block.region?.className !== "title") return Math.max(own * 0.9, 6)
    const similar = titleSizes.filter((size) => Math.abs(size - own) <= own * 0.15)
    return Math.max((median(similar) || own) * 0.9, 6)
  }
  return {
    fontSizeFor,
    lineHeightFor: (block) => {
      if (block.region?.className !== "title") return bodyLineHeight
      const own = median(block.paras.map((p) => p.fontSize)) || 12
      const leadings = translated
        .filter((b) => b.region?.className === "title")
        .filter((b) => Math.abs(median(b.paras.map((p) => p.fontSize)) - own) <= own * 0.15)
        .map(titleLeadingFor)
      const leading = median(leadings)
      return leading > 0 ? ratio(leading, fontSizeFor(block)) : bodyLineHeight
    },
  }
}
