import type { Region } from "../../layout/model-runner"
import { describe, expect, it } from "vitest"
import { assignItems } from "../assign"

// 回归：transform[5] 是基线（字形几乎全在基线上方），旧代码把基线当盒底用，
// item 几何整体下移约半个字高 → 压在区域底边上的行（视觉上被框盖住）被误判为孤儿。
describe("assign 边缘行归属与段落盒", () => {
  it("字形盒被区域完整覆盖、但旧基线中心点在框外的行，应归属该区域而非孤儿", () => {
    const pageH = 792
    // item：基线 y-up = 100，字形盒顶 y = 100 + 0.8*10 = 108，盒子 [98, 108]。
    // 旧几何的中心 = 95（基线-0.5h），落在区域外；正确中心 = 103，落在区域内。
    const items = [{ str: "available at", x: 0, y: 108, w: 50, h: 10, order: 0, fontName: "f" }]
    // 区域 y-up [99, 108]（盖住字形盒）。assignItems 期望已翻转到 y-up 的区域
    // （对应 css y-down y1=684, y2=693，即 main.ts 里 flipRegionY 之后的样子）
    const regions: Region[] = [
      {
        x1: -10,
        y1: 99,
        x2: 100,
        y2: 108,
        className: "plain text",
        behavior: "translate",
        conf: 1,
      },
    ]
    const blocks = assignItems(items, regions, 612, pageH)
    const regionBlock = blocks.find((b) => b.region !== null)
    expect(regionBlock).toBeDefined()
    expect(regionBlock!.paras).toHaveLength(1)
    expect(regionBlock!.paras[0]!.text).toBe("available at")
    // 段落盒必须等于字形盒：盒底取字形底（98）而非字形顶（108），
    // 否则 render-view 的白底块会差一个字高盖不住末行
    expect(regionBlock!.paras[0]!.y).toBe(98)
    expect(regionBlock!.paras[0]!.y + regionBlock!.paras[0]!.h).toBe(108)
    const orphan = blocks.find((b) => b.region === null)
    expect(!orphan || orphan.paras.length === 0).toBe(true)
  })
})
