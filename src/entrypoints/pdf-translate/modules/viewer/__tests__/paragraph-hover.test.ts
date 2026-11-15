import type { AssignedBlock } from "@/modules/pdf-core/assign/assign"
import type { DocumentGroup } from "@/modules/pdf-core/document-flow"
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { createPageHost } from "../pagehost"
import { createParagraphHover } from "../paragraph-hover"
import { renderBlocks } from "../render-view"

describe("paragraph hover", () => {
  it("highlights the matching paragraph from either page and clears on leave", () => {
    const left = createPageHost(document, 500, 700, document.createElement("canvas"))
    const right = createPageHost(document, 500, 700, document.createElement("canvas"))
    const blocks = [
      {
        behavior: "translate",
        minOrder: 0,
        region: null,
        paras: [
          { x: 20, y: 600, w: 100, h: 30, text: "first", lineCount: 1, fontSize: 12, lines: [] },
          { x: 20, y: 500, w: 100, h: 30, text: "second", lineCount: 1, fontSize: 12, lines: [] },
        ],
      },
    ] as unknown as AssignedBlock[]
    const views = renderBlocks(right, blocks, () => {})
    createParagraphHover().install(1, left, right, blocks, views, 500, 700, 0)
    const secondBox = views[0]!.clusters[1]!.box
    secondBox.style.top = "150px"
    secondBox.style.height = "18px"
    left.root.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 30, clientY: 75 }),
    )
    expect(left.root.querySelector(".paragraph-hover-highlight")?.getAttribute("style")).toContain(
      "top: 70px",
    )
    expect(right.root.querySelectorAll(".paragraph-hover-highlight")).toHaveLength(1)
    right.root.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 30, clientY: 155 }),
    )
    expect(left.root.querySelector(".paragraph-hover-highlight")?.getAttribute("style")).toContain(
      "top: 170px",
    )
    expect(right.root.querySelector(".paragraph-hover-highlight")?.getAttribute("style")).toContain(
      "top: 150px",
    )
    right.root.dispatchEvent(new MouseEvent("pointerleave"))
    expect(left.root.querySelectorAll(".paragraph-hover-highlight")).toHaveLength(0)
  })
  it("跨页同段在两个页面的原文和译文框上同时高亮", () => {
    const hover = createParagraphHover()
    const hosts = [1, 2].map(() => ({
      left: createPageHost(document, 500, 700, document.createElement("canvas")),
      right: createPageHost(document, 500, 700, document.createElement("canvas")),
    }))
    hosts.forEach(({ left, right }, i) => {
      const blocks = [
        {
          behavior: "translate",
          minOrder: 0,
          region: null,
          paras: [
            {
              x: 20,
              y: 600,
              w: 100,
              h: 30,
              text: `part ${i}`,
              lineCount: 1,
              fontSize: 12,
              lines: [],
            },
          ],
        },
      ] as unknown as AssignedBlock[]
      hover.install(
        i + 1,
        left,
        right,
        blocks,
        renderBlocks(right, blocks, () => {}),
        500,
        700,
        0,
      )
    })
    hover.setGroups([
      { parts: [1, 2].map((pageIndex) => ({ id: `p${pageIndex}:b0:s0` })) },
    ] as unknown as DocumentGroup[])
    hosts[0]!.left.root.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 30, clientY: 75 }),
    )
    for (const host of hosts) {
      expect(host.left.root.querySelectorAll(".paragraph-hover-highlight")).toHaveLength(1)
      expect(host.right.root.querySelectorAll(".paragraph-hover-highlight")).toHaveLength(1)
    }
    hosts[1]!.right.root.dispatchEvent(new MouseEvent("pointerleave"))
    for (const host of hosts)
      expect(host.left.root.querySelectorAll(".paragraph-hover-highlight")).toHaveLength(0)
  })
  it("同页跨栏同段同时高亮两个原文框和两个译文框", () => {
    const left = createPageHost(document, 500, 700, document.createElement("canvas"))
    const right = createPageHost(document, 500, 700, document.createElement("canvas"))
    const blocks = [
      {
        behavior: "translate",
        minOrder: 0,
        region: null,
        paras: [
          { x: 20, y: 600, w: 100, h: 30, text: "left", lineCount: 1, fontSize: 12, lines: [] },
          { x: 270, y: 600, w: 100, h: 30, text: "right", lineCount: 1, fontSize: 12, lines: [] },
        ],
      },
    ] as unknown as AssignedBlock[]
    const hover = createParagraphHover()
    hover.install(
      1,
      left,
      right,
      blocks,
      renderBlocks(right, blocks, () => {}),
      500,
      700,
      0,
    )
    hover.setGroups([
      { parts: [0, 1].map((i) => ({ id: `p1:b0:s${i}` })) },
    ] as unknown as DocumentGroup[])
    left.root.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 30, clientY: 75 }),
    )
    expect(left.root.querySelectorAll(".paragraph-hover-highlight")).toHaveLength(2)
    expect(right.root.querySelectorAll(".paragraph-hover-highlight")).toHaveLength(2)
  })
})

it("左右侧右键定位合并前原块，菜单期间只高亮该块，空白处不命中", () => {
  const left = createPageHost(document, 500, 700, document.createElement("canvas"))
  const right = createPageHost(document, 500, 700, document.createElement("canvas"))
  const blocks = [0, 1].map((i) => ({
    behavior: "translate",
    minOrder: i,
    region: {
      x1: 20,
      y1: 450,
      x2: 120,
      y2: 650,
      className: "plain text",
      conf: 0.9,
      behavior: "translate",
    },
    paras: [
      {
        x: 20,
        y: 600 - i * 100,
        w: 100,
        h: 30,
        text: `part ${i}`,
        lineCount: 1,
        fontSize: 12,
        lines: [],
      },
    ],
  })) as AssignedBlock[]
  const views = renderBlocks(right, blocks, () => {})
  const hover = createParagraphHover()
  hover.install(1, left, right, blocks, views, 500, 700, 0)
  hover.setGroups([{ parts: [0, 1].map((i) => ({ id: `p1:b${i}:s0` })) }] as DocumentGroup[])
  const pick = (target: HTMLElement, y: number) => {
    const event = new MouseEvent("contextmenu", { clientX: 30, clientY: y })
    target.dispatchEvent(event)
    return hover.pick(event)
  }
  expect(pick(left.root, 175)?.block).toBe(blocks[1])
  expect(left.root.querySelectorAll(".paragraph-hover-highlight")).toHaveLength(1)
  left.root.dispatchEvent(new MouseEvent("pointerleave"))
  expect(left.root.querySelectorAll(".paragraph-hover-highlight")).toHaveLength(1)
  hover.clearSelection()
  expect(left.root.querySelectorAll(".paragraph-hover-highlight")).toHaveLength(0)
  expect(pick(views[0]!.clusters[0]!.box, 75)?.block).toBe(blocks[0])
  hover.clearSelection()
  expect(pick(left.root, 350)).toBeNull()
})
