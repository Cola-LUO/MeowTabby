/** @vitest-environment jsdom */
import type { AssignedBlock, Paragraph } from "@/modules/pdf-core/assign/assign"
import type { DocumentPart, DocumentUnit } from "@/modules/pdf-core/document-flow"
import { describe, expect, it } from "vitest"
import { createPageHost } from "../pagehost"
import { renderBlocks } from "../render-view"
import { buildTranslationUnits } from "../trans-units"

function setup(pageIndex: number, texts: string[], title = false, width = 200, height = 20) {
  const paras: Paragraph[] = texts.map((text, i) => ({
    text,
    x: 40,
    y: 700 - i * 60,
    w: width,
    h: height,
    fontSize: 10,
    lineCount: 2,
    lines: [],
    soloCluster: true,
  }))
  const block: AssignedBlock = {
    region: {
      x1: 40,
      y1: 600,
      x2: 240,
      y2: 730,
      behavior: "translate",
      conf: 0.9,
      className: title ? "title" : "plain text",
    },
    behavior: "translate",
    paras,
    minOrder: 0,
  }
  const views = renderBlocks(
    createPageHost(document, 612, 792, document.createElement("canvas")),
    [block],
    () => {},
  )
  const parts: DocumentPart[] = paras.map((paragraph, paraIdx) => ({
    id: `${pageIndex}:${paraIdx}`,
    pageIndex,
    blockId: "b0",
    paraIdx,
    block,
    paragraph,
  }))
  return { views, parts }
}
function unit(parts: DocumentPart[], kind: DocumentUnit["kind"] = "view"): DocumentUnit {
  return { id: parts.map((p) => p.id).join("|"), kind, parts }
}

describe("D文档单元回填现有原位盒", () => {
  it("普通段各自请求，并写回各自的原位盒", () => {
    const { views, parts } = setup(1, ["one", "two"])
    const units = buildTranslationUnits(
      parts.map((part) => unit([part])),
      new Map([[1, views]]),
    )
    expect(units.map((u) => u.request)).toEqual(["one", "two"])
    units[0]!.fill("译一")
    units[1]!.fill("译二")
    expect(views[0]!.clusters.map((c) => c.box.textContent)).toEqual(["译一", "译二"])
    expect(views[0]!.clusters.map((c) => c.box.style.top)).toEqual(["72px", "132px"])
  })
  it("普通段无需分段标记即可回填", () => {
    const { views, parts } = setup(1, ["one", "two"])
    const units = buildTranslationUnits([unit(parts)], new Map([[1, views]]))
    expect(units[0]!.request).toBe("one two")
    units[0]!.fill("译一。译二")
    expect(views[0]!.clusters.map((c) => c.box.textContent).join("")).toBe("译一。译二")
  })
  it("三页组只发一条请求，分别写回三个原位盒", () => {
    const pages = [setup(1, ["first"]), setup(2, ["second"]), setup(3, ["third"])]
    const views = new Map(pages.map((p, i) => [i + 1, p.views]))
    const units = buildTranslationUnits(
      [
        unit(
          pages.flatMap((p) => p.parts),
          "group",
        ),
      ],
      views,
    )
    expect(units).toHaveLength(1)
    expect(units[0]!.request).toBe("first second third")
    const before = pages.map((p) => p.views[0]!.clusters[0]!.box.style.cssText)
    units[0]!.fill("A B C D E F")
    expect(pages.map((p) => p.views[0]!.clusters[0]!.box.textContent).join("")).toBe("A B C D E F")
    expect(pages.map((p) => p.views[0]!.clusters[0]!.box.style.left)).toEqual([
      "40px",
      "40px",
      "40px",
    ])
    expect(before.every(Boolean)).toBe(true)
    expect(units[0]!.layoutTargets).toHaveLength(3)
  })
  it("等待段之后的回填不清除已写入的前文", () => {
    const { views, parts } = setup(1, ["one", "two"])
    const map = new Map([[1, views]])
    buildTranslationUnits([unit([parts[0]!])], map)[0]!.fill("译一")
    buildTranslationUnits([unit([parts[1]!])], map)[0]!.fill("译二")
    expect(views[0]!.clusters.map((c) => c.box.textContent)).toEqual(["译一", "译二"])
  })
  it("标题整体送翻并回填一个标题盒", () => {
    const { views, parts } = setup(1, ["main", "subtitle"], true)
    const units = buildTranslationUnits([unit(parts, "title")], new Map([[1, views]]))
    expect(units[0]!.request).toBe("main subtitle")
    units[0]!.fill("整条标题")
    expect(views[0]!.clusters[0]!.box.textContent).toBe("整条标题")
  })
  it("合并组所有文字框锁定原位高度", () => {
    const a = setup(1, ["first"]),
      b = setup(2, ["second"])
    const units = buildTranslationUnits(
      [unit([...a.parts, ...b.parts], "group")],
      new Map([
        [1, a.views],
        [2, b.views],
      ]),
    )
    expect(units[0]!.layoutTargets.map((t) => t.availHeight)).toEqual([20, 20])
    expect(units[0]!.groupBoxes?.map((t) => t.isLast)).toEqual([false, true])
  })
  it("重复回填清空本盒，不累积文字", () => {
    const { views, parts } = setup(1, ["one"])
    const u = buildTranslationUnits([unit(parts)], new Map([[1, views]]))[0]!
    u.fill("译一")
    u.fill("译二")
    expect(views[0]!.clusters[0]!.box.textContent).toBe("译二")
  })
  it("缺少回填目标时明确失败，不能静默漏掉原文", () => {
    const { parts } = setup(1, ["one"])
    expect(() => buildTranslationUnits([unit(parts)], new Map())).toThrow(/回填/)
  })
})

describe("保留合并组原有字符容量分配", () => {
  function narrowGroup() {
    const a = setup(1, ["first"], false, 60, 10)
    const b = setup(2, ["second"], false, 60, 10)
    const group = buildTranslationUnits(
      [unit([...a.parts, ...b.parts], "group")],
      new Map([
        [1, a.views],
        [2, b.views],
      ]),
    )[0]!
    return { group, boxes: [a.views[0]!.clusters[0]!.box, b.views[0]!.clusters[0]!.box] }
  }
  it("只有原位高度时沿用统一降字号和字符切分", () => {
    const { group, boxes } = narrowGroup()
    group.fill("甲译一句。乙译二句。丙译三句。")
    expect(boxes.map((box) => box.textContent)).toEqual(["甲译一句。乙译二", "句。丙译三句。"])
    expect(boxes[0]!.style.fontSize).toBe(`${9 * 0.81}px`)
  })
  it("合并组所有文字框沿用原位容量（availHeight = 原位高）", () => {
    const { group, boxes } = narrowGroup()
    group.fill("甲译一句。乙译二句。丙译三句。")
    expect(boxes.map((box) => box.textContent)).toEqual(["甲译一句。乙译二", "句。丙译三句。"])
    expect(boxes[0]!.style.fontSize).toBe(`${9 * 0.81}px`)
    expect(group.layoutTargets.map((t) => t.availHeight)).toEqual([10, 10])
  })
  it("实测后重排替换原文字，保持全部译文", () => {
    const { group, boxes } = narrowGroup()
    const translated = "甲译一句。乙译二句。丙译三句。"
    group.fill(translated)
    expect(group.refit!(0.66)).toBe(true)
    expect(boxes.map((box) => box.textContent).join("")).toBe(translated)
    expect(boxes[0]!.style.fontSize).toBe("5.94px")
  })
})

it("等待中的多段标题保留单簇并透明显示原文", () => {
  const { parts } = setup(1, ["main", "subtitle"], true)
  const views = renderBlocks(
    createPageHost(document, 612, 792, document.createElement("canvas")),
    [parts[0]!.block],
    () => {},
    undefined,
    new Set(parts.map((p) => p.paragraph)),
  )
  expect(views[0]!.clusters).toHaveLength(1)
  expect(views[0]!.clusters[0]!.box.style.backgroundColor).toBe("transparent")
})
