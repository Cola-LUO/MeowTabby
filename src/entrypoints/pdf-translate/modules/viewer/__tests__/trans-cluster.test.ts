import type { AssignedBlock, Paragraph } from "@/modules/pdf-core/assign/assign"
import type { Region } from "@/modules/pdf-core/layout/model-runner"
/** 白底盒按"簇"回到段落原位（2026-09-14）
 *  事故背景：4 个 abandon 框的文字被整页兜底块收编，块盒 = 块内全部段落矩形并集
 *  → x52-421 / y38-752（714px 高、263k px²），白底把左栏半页盖掉。
 *  本文件锁住：① 分散段落必须分簇；② 每簇盒的位置/高度 = 该簇自己的原位/原高。 */
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { createPageHost } from "../pagehost"
import {
  CLUSTER_GAP,
  clusterParas,
  distributeTexts,
  distributeTextsSkip,
  renderBlocks,
  type BlockView,
} from "../render-view"

const PAGE_W = 595
const PAGE_H = 794

/** 段落用 y-up 口径（y = 底、h = 高）：display y-down 的 y1 = PAGE_H-(y+h)、y2 = PAGE_H-y */
function para(x: number, y: number, w: number, h: number, text = "text", fontSize = 10): Paragraph {
  return { x, y, w, h, text, lineCount: 1, fontSize, lines: [] }
}

function translateBlock(paras: Paragraph[], className = "plain text"): AssignedBlock {
  const region: Region = {
    x1: 40,
    y1: 40,
    x2: 560,
    y2: 760,
    className,
    conf: 0.9,
    behavior: "translate",
  }
  return { minOrder: 0, region, behavior: "translate", paras }
}

const host = () => createPageHost(document, PAGE_W, PAGE_H, document.createElement("canvas"))
const clusterBoxes = (view: BlockView): HTMLElement[] =>
  [...view.el.querySelectorAll(".trans-cluster")] as HTMLElement[]

/** 污水检测第 1 页实拍数据（display y-down）：页眉 38-44、横幅 67-75 / 131-139、页脚 708-726 / 735-752 */
const SCATTERED = [
  para(179, 750, 242, 6), // 页眉
  para(218, 719, 167, 8), // 横幅 1
  para(219, 655, 164, 8), // 横幅 2
  para(56, 68, 236, 18), // 页脚 1
  para(52, 42, 210, 17), // 页脚 2
]

describe("clusterParas：块内段落按纵向邻接聚簇", () => {
  it("邻接段落（正常正文）聚成一簇", () => {
    expect(
      clusterParas([para(50, 700, 400, 10), para(50, 689, 400, 10), para(50, 678, 400, 10)]),
    ).toEqual([[0, 1, 2]])
  })

  it("空隙 ≤ max(3×段落高中位, 24) 同簇，超过即断开（本例阈值 = 3×10 = 30）", () => {
    expect(clusterParas([para(50, 700, 400, 10), para(50, 660, 400, 10)])).toEqual([[0, 1]])
    expect(clusterParas([para(50, 700, 400, 10), para(50, 659, 400, 10)])).toEqual([[0], [1]])
    expect(CLUSTER_GAP).toBe(24)
  })

  it("页眉/横幅/页脚这种远隔段落各自成簇（半页白事故的回归保护）", () => {
    expect(clusterParas(SCATTERED)).toEqual([[0, 1], [2], [3, 4]])
  })

  it("横向不相交（左右并列）分簇", () => {
    expect(clusterParas([para(50, 700, 200, 10), para(400, 700, 150, 10)])).toEqual([[0], [1]])
  })
})

describe("renderBlocks：白底盒落在各簇原位", () => {
  it("分散段落不再合成跨页巨盒——盒数与位置=各簇原位", () => {
    const views = renderBlocks(host(), [translateBlock(SCATTERED)], () => {})
    expect(views).toHaveLength(1)
    const boxes = clusterBoxes(views[0]!)
    expect(boxes).toHaveLength(5)
    expect(boxes.map((b) => parseFloat(b.style.top))).toEqual([38, 67, 131, 708, 735])
    expect(boxes.map((b) => parseFloat(b.style.height))).toEqual([6, 8, 8, 18, 17])
    // 旧实现是整块并集：top=38 / 高 714 / 面积 263k px²
    expect(Math.max(...boxes.map((b) => parseFloat(b.style.height)))).toBeLessThan(60)
  })

  it("块容器退化为分组：0×0、透明（白底全在簇盒上）", () => {
    const views = renderBlocks(host(), [translateBlock([para(50, 700, 400, 10)])], () => {})
    const el = views[0]!.el
    expect(el.className).toBe("trans-block")
    expect(el.style.width).toBe("0px")
    expect(el.style.height).toBe("0px")
    expect(el.style.background).toBe("")
    expect(clusterBoxes(views[0]!)[0]!.style.background).toBe("rgb(255, 255, 255)")
  })

  it("旋转页：display 变换逐簇套用（每簇各自 rotate）", () => {
    const seen: number[] = []
    const views = renderBlocks(
      host(),
      [translateBlock([para(50, 700, 400, 10), para(50, 40, 300, 10)])],
      () => {},
      (box) => {
        seen.push(box.y)
        return { left: 1, top: 2, width: 3, height: 4, rotateDeg: 90 }
      },
    )
    expect(seen).toHaveLength(2)
    const boxes = clusterBoxes(views[0]!)
    expect(boxes).toHaveLength(2)
    expect(boxes.every((b) => b.style.transform.includes("rotate(90deg)"))).toBe(true)
    expect(boxes.map((b) => b.style.left)).toEqual(["1px", "1px"])
  })

  it("簇盒写 dataset.minHeight/baseFontSize（验收与求解器共用，jsdom 下 offsetHeight 恒 0 不能实测）", () => {
    const views = renderBlocks(host(), [translateBlock(SCATTERED)], () => {})
    const boxes = clusterBoxes(views[0]!)
    expect(boxes.map((b) => b.dataset.minHeight)).toEqual(["6", "8", "8", "18", "17"])
    expect(boxes.every((b) => Number(b.dataset.baseFontSize) > 0)).toBe(true)
  })

  it("簇的下标映射可供译文回填（idx 指向原 paras）", () => {
    const views = renderBlocks(host(), [translateBlock(SCATTERED)], () => {})
    expect(views[0]!.clusters.map((c) => c.idx)).toEqual([[0], [1], [2], [3], [4]])
  })
})

describe("title 块：整块一并送翻、不分段、只有一个盒", () => {
  it("即使段落间有大空隙，title 块也只出一个盒（不留空盒盖住整条译文）", () => {
    const views = renderBlocks(
      host(),
      [translateBlock([para(50, 700, 400, 10), para(50, 600, 300, 10)], "title")],
      () => {},
    )
    expect(views[0]!.noSegment).toBe(true)
    expect(views[0]!.clusters).toHaveLength(1)
    expect(views[0]!.clusters[0]!.idx).toEqual([0, 1])
  })

  it("普通块保持默认的分段回填（与 title 的整体性相反）", () => {
    const views = renderBlocks(host(), [translateBlock([para(50, 700, 400, 10)])], () => {})
    expect(views[0]!.noSegment).toBe(false)
  })

  it("段数不符时标题译文也按占比铺开（标题整体性由 trans-units 的 title fill 保证，不再走本函数）", () => {
    const view = renderBlocks(
      host(),
      [translateBlock([para(50, 700, 400, 10), para(50, 600, 300, 10)], "title")],
      () => {},
    )[0]!
    const out = distributeTexts(view, [], "整条标题译文")
    expect(out).toHaveLength(1) // 标题块强制单簇
    expect(out[0]!.join("")).toBe("整条标题译文") // 不丢字
  })
})

describe("distributeTexts：块级译文按段下标分发到各簇盒", () => {
  const view = (): BlockView => renderBlocks(host(), [translateBlock(SCATTERED)], () => {})[0]!

  it("段数相符 → 各簇只拿到自己那几段（顺序不变）", () => {
    const segs = ["S0", "S1", "S2", "S3", "S4"]
    expect(distributeTexts(view(), segs, segs.join("\n\n%%\n\n"))).toEqual(segs.map((s) => [s]))
  })

  it("段数不符 → 按各段原文占比铺开，不丢字、不空盒", () => {
    const out = distributeTexts(view(), ["整段译文"], "整段译文")
    expect(out.flat().join("")).toBe("整段译文") // 不丢字
    // 铺开而非全挤首簇：至少两个簇拿到内容（旧行为是首簇独吞、盒被撑长）
    expect(out.filter((paras) => paras.some((t) => t !== "")).length).toBeGreaterThan(1)
  })

  it("段数不符且译文含 %% 字样 → 当作普通文本原样保留，不剥不丢", () => {
    const out = distributeTexts(view(), ["x"], "第一段\n\n%%\n\n第二段")
    expect(out.flat().join("")).toBe("第一段\n\n%%\n\n第二段")
  })

  it("空译文 → 各簇皆空（白底仍在，等下次翻译）", () => {
    expect(distributeTexts(view(), [], "")).toEqual([[], [], [], [], []])
  })
})

describe("clusterParas：soloCluster 段强制独簇（跨栏合并组成员）", () => {
  it("solo 在中间：即便邻接判据满足，前一段与后一段均不并入（三段各自成簇）", () => {
    const a = para(50, 700, 400, 10)
    const b = para(50, 660, 400, 10)
    const c = para(50, 620, 400, 10)
    b.soloCluster = true
    expect(clusterParas([a, b, c])).toEqual([[0], [1], [2]])
  })

  it("solo 在首：其后邻接段不得并入 solo 簇，但仍可正常互相聚簇", () => {
    const a = para(50, 700, 400, 10)
    a.soloCluster = true
    expect(clusterParas([a, para(50, 660, 400, 10), para(50, 620, 400, 10)])).toEqual([[0], [1, 2]])
  })
})

describe("renderBlocks：pendingParas 挂起段透明占位（跨页合并的回填目标）", () => {
  it("挂起段照常建簇盒：idx 含该段、盒背景 transparent、位置=原位；其余段白盒正常", () => {
    const pending = SCATTERED[1]! // 横幅 1
    const views = renderBlocks(
      host(),
      [translateBlock(SCATTERED)],
      () => {},
      undefined,
      new Set([pending]),
    )
    // 占位段独簇：页眉（下标 0）与横幅 2（下标 2）都不得并入占位簇——共享盒会让邻段失去白底
    expect(views[0]!.clusters.map((c) => c.idx)).toEqual([[0], [1], [2], [3], [4]])
    expect(clusterBoxes(views[0]!)).toHaveLength(5)
    const boxes = clusterBoxes(views[0]!)
    // 占位盒：位置 = 横幅 1 原位（67）、背景透明（挂起期间原文从 canvas 透出）
    const pendingBox = views[0]!.clusters.find((c) => c.idx.includes(1))!.box
    expect(pendingBox.style.backgroundColor).toBe("transparent")
    expect(parseFloat(pendingBox.style.top)).toBe(67)
    expect(parseFloat(pendingBox.style.height)).toBe(8)
    // 其余簇白盒不受连累：页眉 38、横幅 2 131、页脚 708，背景仍 #fff
    expect(boxes.filter((b) => b !== pendingBox).map((b) => parseFloat(b.style.top))).toEqual([
      38, 131, 708, 735,
    ])
    expect(
      boxes
        .filter((b) => b !== pendingBox)
        .every((b) => b.style.background === "rgb(255, 255, 255)"),
    ).toBe(true)
    // BlockView.paras 仍引用 block.paras 原数组（paraIdx 对齐全量）
    expect(views[0]!.paras).toBe(SCATTERED)
    expect(views[0]!.paras).toHaveLength(5)
  })
})

describe("renderBlocks：soloParas 强制独簇（跨页 headMerge 的头段）", () => {
  it("头段与邻段同簇判据满足时也强制独簇，且建白底盒（非透明占位）", () => {
    // 页眉（下标0）与横幅1（下标1）正常判据同簇（见上方 SCATTERED 用例 [[0,1],…]）；
    // 头段将被跨页组单元 fillBlockText 整盒替换，共享盒会连邻段译文一起清掉 → 必须独簇
    const head = SCATTERED[1]!
    const views = renderBlocks(
      host(),
      [translateBlock(SCATTERED)],
      () => {},
      undefined,
      undefined,
      new Set([head]),
    )
    expect(views[0]!.clusters.map((c) => c.idx)).toEqual([[0], [1], [2], [3], [4]])
    const headBox = views[0]!.clusters.find((c) => c.idx.includes(1))!.box
    // 头段不是挂起占位：白底正常建盒（跨页合并命中后译文直接可见）
    expect(headBox.style.backgroundColor).not.toBe("transparent")
    expect(headBox.style.background).toBe("rgb(255, 255, 255)")
    expect(parseFloat(headBox.style.top)).toBe(67)
  })

  it("不传 soloParas 时行为不变（向后兼容）", () => {
    const views = renderBlocks(host(), [translateBlock(SCATTERED)], () => {})
    expect(views[0]!.clusters.map((c) => c.idx)).toEqual([[0], [1], [2], [3], [4]])
  })
})

describe("distributeTextsSkip：带剔除段的译文映射（合并组成员由合并单元回填，这里得空串）", () => {
  it("段数相符 → segments 依序对应未跳过段，跳过段得空串", () => {
    const v = renderBlocks(
      host(),
      [translateBlock([para(50, 700, 400, 10), para(50, 689, 400, 10), para(50, 678, 400, 10)])],
      () => {},
    )[0]!
    expect(v.clusters).toHaveLength(3)
    expect(distributeTextsSkip(v, ["甲", "丙"], "甲\n\n%%\n\n丙", new Set([1]))).toEqual([
      ["甲"],
      [""],
      ["丙"],
    ])
  })

  it("多簇：跳过整簇时该簇全空，其余簇按未跳过段依序取译文", () => {
    const v = renderBlocks(host(), [translateBlock(SCATTERED)], () => {})[0]!
    expect(distributeTextsSkip(v, ["甲", "乙", "丙"], "x", new Set([0, 1]))).toEqual([
      [""],
      [""],
      ["甲"],
      ["乙"],
      ["丙"],
    ])
  })

  it("段数不符 → 未跳过段按原文占比分摊整条译文（跳过段仍为空）", () => {
    const v = renderBlocks(host(), [translateBlock(SCATTERED)], () => {})[0]!
    const out = distributeTextsSkip(v, ["整段译文"], "整段译文", new Set([1]))
    expect(out[1]![0]).toBe("") // 跳过段为空
    expect(out.flat().join("")).toBe("整段译文") // 不丢字
    expect(out.filter((paras) => paras.some((t) => t !== "")).length).toBeGreaterThan(1)
  })
})
