import type { AnalyzePageInput } from "../pipeline"
import { describe, expect, it } from "vitest"
import { planFlatMerges } from "../assign/cross-merge"
import { analyzePage } from "../pipeline"
import fixture from "./fixtures/d-golden.json"

describe("原验证器 D 黄金数据", () => {
  for (const sample of fixture.cases) {
    it(`黄金案例 ${sample.input.name}`, () => {
      const page = analyzePage(structuredClone(sample.input) as AnalyzePageInput)
      const { groups, decisions } = planFlatMerges(
        page.order.seq.map((block) => ({ block, page: page.index })),
      )
      const result = {
        regionsUp: page.regionsUp,
        blocks: page.blocks,
        order: {
          indices: page.order.seq.map((b) => page.blocks.indexOf(b)),
          total: page.order.total,
          placed: page.order.placed,
        },
        groups: groups.map((g) => ({
          parts: g.parts.map((p) => ({
            block: page.blocks.indexOf(p.block),
            paraIdx: p.paraIdx,
            text: p.text,
          })),
        })),
        decisions: decisions.map(({ tailBlock, headBlock, ...decision }) => ({
          ...decision,
          tailBlock: page.blocks.indexOf(tailBlock),
          headBlock: page.blocks.indexOf(headBlock),
        })),
      }
      expect(result).toEqual(sample.expected)
    })
  }
})
