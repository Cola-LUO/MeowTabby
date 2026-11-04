import type { Region } from "./layout/model-runner"
import {
  assignItems,
  dropFloatingParas,
  estimateBaseLeading,
  flipRegionY,
  type AssignedBlock,
} from "./assign/assign"
import { walkReadingOrder, type WalkReadingOrderResult } from "./assign/reading-order"
import { repairRegions } from "./layout/repair"
import { regionToUnrotated } from "./pdf/coords-rot"
import { sameTextLine, type PdfTextItem } from "./pdf/text-items"

export interface AnalyzePageInput {
  index: number
  cssW: number
  cssH: number
  rotate?: number
  items: PdfTextItem[]
  /** A/B 验证专用；产品默认使用内容流顺序。 */
  paragraphTextOrder?: "line" | "content"
  /** 模型或切片返回的显示空间原始框，y 向下。 */
  regions: Region[]
}

export interface PageAnalysis {
  index: number
  cssW: number
  cssH: number
  pageWu: number
  pageHu: number
  rotate: number
  items: PdfTextItem[]
  regions: Region[]
  regionsUp: Region[]
  regionsDown: Region[]
  blocks: AssignedBlock[]
  keepUp: Region[]
  order: WalkReadingOrderResult
}

function itemInRegion(item: PdfTextItem, region: Region): boolean {
  const cx = item.x + item.w / 2
  const cy = item.y - item.h / 2
  return cx >= region.x1 && cx <= region.x2 && cy >= region.y1 && cy <= region.y2
}

function keepInlineFormulaCaptions(regions: Region[], items: PdfTextItem[]): void {
  const formulas = regions.filter((r) => r.className === "isolate_formula" && r.behavior === "keep")
  for (const caption of regions) {
    if (caption.className !== "formula_caption" || caption.behavior !== "translate") continue
    const captionItems = items.filter((item) => itemInRegion(item, caption))
    if (
      captionItems.some((captionItem) =>
        formulas.some((formula) =>
          items.some(
            (formulaItem) =>
              formulaItem !== captionItem &&
              itemInRegion(formulaItem, formula) &&
              sameTextLine(captionItem, formulaItem),
          ),
        ),
      )
    )
      caption.behavior = "keep"
  }
}

/** 产品与验证器唯一的单页 D 后处理入口。 */
export function analyzePage(input: AnalyzePageInput): PageAnalysis {
  const { index, cssW, cssH, items, regions } = input
  const rotate = (((input.rotate ?? 0) % 360) + 360) % 360
  const rotated = rotate === 90 || rotate === 270
  const pageWu = rotated ? cssH : cssW
  const pageHu = rotated ? cssW : cssH
  const mappedRegions = regions.map((r) => {
    if (rotate === 0) return flipRegionY(r, cssH)
    const box = regionToUnrotated(r, cssW, cssH, rotate)
    return { ...r, x1: box.x, y1: box.y, x2: box.x + box.w, y2: box.y + box.h }
  })
  keepInlineFormulaCaptions(mappedRegions, items)
  const regionsUp = repairRegions(mappedRegions, items)
  // 旋转页的显示框保持既有产品口径；核心坐标只适配一次。
  const regionsDown =
    rotate !== 0
      ? regions.map((r, i) => ({ ...r, behavior: mappedRegions[i]!.behavior }))
      : regionsUp.map((r) => flipRegionY(r, cssH))
  const blocks = assignItems(items, regionsUp, pageWu, pageHu, input.paragraphTextOrder)
  const leading = estimateBaseLeading(
    items,
    regionsUp.filter((r) => r.behavior === "translate"),
  )
  dropFloatingParas(blocks, leading)
  return {
    index,
    cssW,
    cssH,
    pageWu,
    pageHu,
    rotate,
    items,
    regions,
    regionsUp,
    regionsDown,
    blocks,
    keepUp: regionsUp.filter((r) => r.behavior === "keep"),
    order: walkReadingOrder(blocks, pageWu, index),
  }
}
