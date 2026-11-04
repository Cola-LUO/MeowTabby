import type { AssignedBlock } from "@/modules/pdf-core/assign/assign"
import type { Region } from "@/modules/pdf-core/layout/model-runner"
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { createPageHost, renderBlocks } from "../pagehost"

describe("pagehost", () => {
  it("三层结构：canvas + select-layer + trans-layer", () => {
    const canvas = document.createElement("canvas")
    const host = createPageHost(document, 595, 794, canvas)
    expect(host.root.querySelector(".select-layer")).toBeTruthy()
    expect(host.root.querySelector(".trans-layer")).toBeTruthy()
    expect(canvas.className).toBe("page-canvas")
    expect((host.root.querySelector(".trans-layer") as HTMLElement).style.pointerEvents).toBe(
      "none",
    )
  })
})

describe("renderBlocks", () => {
  it("translate 块生成 .trans-block；keep 块不生成", () => {
    const canvas = document.createElement("canvas")
    const host = createPageHost(document, 595, 794, canvas)
    const region = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      className: string,
      behavior: any,
    ): Region => ({ x1, y1, x2, y2, className, conf: 0.9, behavior })
    const blocks: AssignedBlock[] = [
      {
        minOrder: 0,
        region: region(50, 100, 500, 300, "plain text", "translate"),
        behavior: "translate",
        paras: [
          { x: 50, y: 290, w: 400, h: 30, text: "hello", lineCount: 2, fontSize: 10, lines: [] },
        ],
      },
      {
        minOrder: 0,
        region: region(50, 400, 500, 600, "figure", "keep"),
        behavior: "keep",
        paras: [],
      },
    ]
    const ids = renderBlocks(host, blocks, () => {})
    expect(host.root.querySelectorAll(".trans-block")).toHaveLength(1)
    expect(ids).toHaveLength(1)
    // 白底盒在簇上（单段块 = 单簇），容器自身不铺白底
    expect(host.root.querySelectorAll(".trans-cluster")).toHaveLength(1)
    expect(ids[0]!.clusters).toHaveLength(1)
  })
})
