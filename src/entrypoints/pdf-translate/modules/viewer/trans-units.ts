import type { BlockView, BlockCluster } from "./render-view"
import type { DocumentUnit } from "@/modules/pdf-core/document-flow"
import { requestTextForUnit } from "../translate/segment-utils"
import { splitByCapacity, type PartBox } from "./fit-text"
import { fillMixedText } from "./mixed-text"
import { distributeTextsSkip } from "./render-view"

// D 核心决定送翻成员；本模块只把最终单元连接到已有簇盒与容量分配。
export interface GroupBoxRef {
  box: HTMLElement
  /** 该盒的原位高（CSS px） */
  minHeight: number
  /** 分配时给该盒的可用高（前盒含"向下吃到障碍"的空间；后盒 = 原位高）：复核基准 */
  availHeight: number
  /** 是否最后一个 part（后盒：硬容量，绝不允许撑高） */
  isLast: boolean
}

/** 一个待求解的簇盒（求解在 main.ts 统一做：本模块保持纯逻辑，不碰 DOM 布局） */
export interface ClusterLayoutTarget {
  box: HTMLElement
  /** 原位高（geo.h） */
  minHeight: number
  /** 可用高（≥ minHeight）：obstacles 算出、由 ClusterFitContext 注入 */
  availHeight: number
  width: number
  baseFontSize: number
  lineHeight?: number
}

export interface Unit {
  request: string // 送翻文本（= 缓存 key）
  kind: "view" | "title" | "group" | "released"
  /** 回填（写各簇盒）。group 单元返回**每个 target 的起始字号档位**（splitByCapacity 的结果），
   *  供 main.ts 作为求解器起点（只允许继续降）；其余单元返回 undefined（起点 = 1）。 */
  fill: (translated: string) => number[] | void
  /** group 单元：各 part 白盒（顺序 = part 顺序），供 main.ts 实测复核 */
  groupBoxes?: GroupBoxRef[]
  /** 实测超标 → 用更低字号档位重排并重填；返回是否发生了变化（供 main.ts 决定是否继续降档） */
  refit?: (scale: number) => boolean
  /** 该单元回填后需要求解的簇盒（顺序与回填顺序一致）。普通块与合并组走同一条路径 ——
   *  改动前只有合并组受容量约束，普通块的长译文照样向下长出去压住别人。 */
  layoutTargets: ClusterLayoutTarget[]
}

/** 容量上下文（由 main.ts 注入；缺省一律按"盒的原位高"分配 = 谁都不许长高） */
export interface ClusterFitContext {
  /** 该簇盒的可用总高（CSS px，可含"到下方障碍的距离"）；返回 null 表示未知 → 退回原位高 */
  availHeight?: (pageIndex: number, blockId: string, paraIdx: number) => number | null
}

type FillTarget = { view: BlockView; paraIdx: number; pageIndex: number }

function clusterOf(view: BlockView, paraIdx: number): BlockCluster | null {
  return view.clusters.find((c) => c.idx.includes(paraIdx)) ?? null
}

function targetOf(cluster: BlockCluster): ClusterLayoutTarget {
  return {
    box: cluster.box,
    minHeight: cluster.geo.h,
    availHeight: cluster.geo.h,
    width: cluster.geo.w,
    baseFontSize: cluster.fontSize,
    lineHeight: cluster.lineHeight,
  }
}

export function buildTranslationUnits(
  planned: DocumentUnit[],
  pageViews: Map<number, BlockView[]>,
  _fit?: ClusterFitContext,
): Unit[] {
  const units: Unit[] = []
  const pushGroupUnit = (plan: DocumentUnit, texts: string[], targets: FillTarget[]) => {
    const clusters = targets.map((tg) => clusterOf(tg.view, tg.paraIdx)!)
    const partBoxes: PartBox[] = targets.map((tg, k) => {
      const cl = clusters[k]!
      // 所有文字框保持原位高度，译文通过统一调整字号和切分来容纳。
      return {
        width: cl.geo.w,
        availHeight: cl.geo.h,
        fontSize: cl.fontSize,
        lineHeight: cl.lineHeight,
      }
    })
    let lastRaw = ""
    const apply = (pieces: string[], scale: number) => {
      targets.forEach((tg, k) => {
        const cl = clusters[k]!
        // 必须先清空再写：`fillMixedText` 只追加不清空（既有 fill 只调用一次，故原先无需清），
        // 而实测复核（refit）会整组重排重填 —— 不清会把重排结果追加在旧文字后面。
        cl.box.replaceChildren()
        fillMixedText(cl.box, [pieces[k] ?? ""])
        // 页内组回填涂白无害（本就是 #fff）；跨页组写上页的挂起透明占位盒，
        // 合并命中后挂起解除，涂回白底让译文可见
        cl.box.style.backgroundColor = "#fff"
        // 字号下发/复位：renderBlocks 写死的是 cl.fontSize，缩字号只是乘上档位（不改盒尺寸与 z 序）
        cl.box.style.fontSize = `${cl.fontSize * scale}px`
      })
    }

    units.push({
      request: requestTextForUnit(plan),
      kind: "group",
      // 后盒不吃下吃空间（它在阅读序末尾，往下吃就是压住后面的下文）
      layoutTargets: targets.map((_, k) => targetOf(clusters[k]!)),
      fill: (t) => {
        lastRaw = t
        const { pieces, scale } = splitByCapacity(t, partBoxes)
        apply(pieces, scale)
        // 起始档位交给求解器（只允许继续降），保证"装箱"与"排版"两个阶段同一口径
        return targets.map(() => scale)
      },
      groupBoxes: clusters.map((cl, k) => ({
        box: cl.box,
        minHeight: cl.geo.h,
        // 实测复核基准：分配时给它的可用高（前盒含下吃空间、后盒 = 原位高）
        availHeight: partBoxes[k]!.availHeight,
        isLast: k === targets.length - 1,
      })),
      refit: (scale) => {
        const { pieces } = splitByCapacity(lastRaw, partBoxes, { scales: [scale] })
        apply(pieces, scale)
        return true
      },
    })
  }
  for (const plan of planned) {
    const targets: FillTarget[] = plan.parts.map((part) => {
      const view = pageViews
        .get(part.pageIndex)
        ?.find((v) => v.blockId === part.blockId && v.paras === part.block.paras)
      if (!view || !clusterOf(view, part.paraIdx)) throw new Error(`译文回填目标不存在：${part.id}`)
      return { view, paraIdx: part.paraIdx, pageIndex: part.pageIndex }
    })
    const texts = plan.parts.map((p) => p.paragraph.text)
    if (plan.kind === "group") {
      pushGroupUnit(plan, texts, targets)
      continue
    }
    const first = targets[0]
    if (!first) continue
    const view = first.view
    const indices = new Set(targets.map((t) => t.paraIdx))
    const clusters = view.clusters.filter((c) => c.idx.some((i) => indices.has(i)))
    const skip = new Set(view.paras.map((_, i) => i).filter((i) => !indices.has(i)))
    units.push({
      request: requestTextForUnit(plan),
      kind: plan.kind,
      layoutTargets: clusters.map((c) => targetOf(c)),
      fill: (translated) => {
        if (plan.kind === "title") {
          const box = clusters[0]!.box
          box.replaceChildren()
          fillMixedText(box, [translated])
          box.style.backgroundColor = "#fff"
          return
        }
        const distributed = distributeTextsSkip(view, [translated], translated, skip)
        for (const cluster of clusters) {
          cluster.box.replaceChildren()
          fillMixedText(cluster.box, distributed[view.clusters.indexOf(cluster)] ?? [])
          cluster.box.style.backgroundColor = "#fff"
        }
      },
    })
  }
  return units
}
