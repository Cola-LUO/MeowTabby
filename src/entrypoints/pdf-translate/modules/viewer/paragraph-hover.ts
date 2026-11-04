import type { PageHost } from "./pagehost"
import type { BlockView } from "./render-view"
import type { AssignedBlock } from "@/modules/pdf-core/assign/assign"
import type { DocumentGroup } from "@/modules/pdf-core/document-flow"
import { rendersText } from "@/modules/pdf-core/assign/assign"
import { blockDisplayTransform } from "@/modules/pdf-core/pdf/coords-rot"

type Rect = { x: number; y: number; w: number; h: number }
type Pair = { id: string; source: Rect; box?: HTMLElement }
type Page = {
  left: PageHost
  right: PageHost
  leftLayer: HTMLElement
  rightLayer: HTMLElement
  pairs: Pair[]
}

/** 同段组共用一次高亮：成员可以在同页不同栏，也可以分布在不同页。 */
export function createParagraphHover() {
  const pages = new Map<number, Page>()
  const groupOf = new Map<string, string[]>()
  let active: string | null = null

  const targetRect = (page: Page, box: HTMLElement): Rect => {
    const r = box.getBoundingClientRect()
    const root = page.right.root.getBoundingClientRect()
    return r.width && r.height
      ? { x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height }
      : {
          x: parseFloat(box.style.left),
          y: parseFloat(box.style.top),
          w: parseFloat(box.style.width),
          h: parseFloat(box.style.height),
        }
  }
  const contains = (r: Rect, x: number, y: number) =>
    x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
  const draw = () => {
    for (const page of pages.values()) {
      page.leftLayer.replaceChildren()
      page.rightLayer.replaceChildren()
      if (!active) continue
      const ids = groupOf.get(active) ?? [active]
      for (const pair of page.pairs) {
        if (!ids.includes(pair.id)) continue
        for (const [layer, r] of [
          [page.leftLayer, pair.source],
          [page.rightLayer, pair.box ? targetRect(page, pair.box) : pair.source],
        ] as const) {
          const highlight = layer.ownerDocument.createElement("div")
          highlight.className = "paragraph-hover-highlight"
          highlight.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`
          layer.appendChild(highlight)
        }
      }
    }
  }
  return {
    setGroups(groups: DocumentGroup[]) {
      groupOf.clear()
      for (const group of groups) {
        const ids = group.parts.map((part) => part.id)
        for (const id of ids) groupOf.set(id, ids)
      }
      draw()
    },
    install(
      pageIndex: number,
      left: PageHost,
      right: PageHost,
      blocks: AssignedBlock[],
      views: BlockView[],
      pageWu: number,
      pageHu: number,
      rotate: number,
    ) {
      left.root.querySelector(".paragraph-hover-layer")?.remove()
      right.root.querySelector(".paragraph-hover-layer")?.remove()
      const makeLayer = (host: PageHost) => {
        const layer = host.root.ownerDocument.createElement("div")
        layer.className = "paragraph-hover-layer"
        host.root.appendChild(layer)
        return layer
      }
      const pairs = blocks.filter(rendersText).flatMap((block) =>
        block.paras.map((p, paraIdx) => {
          const blockId = `b${blocks.indexOf(block)}`
          const d = blockDisplayTransform(p, pageWu, pageHu, rotate)
          const x =
            d.rotateDeg === 90 ? d.left - d.height : d.rotateDeg === 180 ? d.left - d.width : d.left
          const y =
            d.rotateDeg === 0
              ? pageHu - p.y - p.h
              : d.rotateDeg === 180
                ? d.top - d.height
                : d.rotateDeg === -90
                  ? d.top - d.width
                  : d.top
          const view = views.find((v) => v.blockId === blockId)
          return {
            id: `p${pageIndex}:${blockId}:s${paraIdx}`,
            source: {
              x,
              y,
              w: d.rotateDeg % 180 ? d.height : d.width,
              h: d.rotateDeg % 180 ? d.width : d.height,
            },
            box: view?.clusters.find((c) => c.idx.includes(paraIdx))?.box,
          }
        }),
      )
      const page: Page = {
        left,
        right,
        leftLayer: makeLayer(left),
        rightLayer: makeLayer(right),
        pairs,
      }
      pages.set(pageIndex, page)
      for (const host of [left, right]) {
        host.root.onpointermove = (event) => {
          const bounds = host.root.getBoundingClientRect()
          const x = event.clientX - bounds.left
          const y = event.clientY - bounds.top
          active =
            pairs.find((pair) =>
              contains(
                host === left ? pair.source : pair.box ? targetRect(page, pair.box) : pair.source,
                x,
                y,
              ),
            )?.id ?? null
          draw()
        }
        host.root.onpointerleave = () => {
          active = null
          draw()
        }
      }
      draw()
    },
  }
}
