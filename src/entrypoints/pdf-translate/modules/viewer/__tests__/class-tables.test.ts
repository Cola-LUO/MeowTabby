// 类别表一致性（2026-09-14 新增）：模型能输出的每个类别都必须在
//   ① `decode.ts` 的 CLASS_BEHAVIOR 里有行为
//   ② `viewer/debug-panel.ts` 的 CLASS_COLORS 里有配色
// 背景：曾经漏收 table_footnote / formula_caption —— 表注被判 skip（文字掉成孤儿、被单独翻成一个孤立译文块），
// 叠加层显示兜底红，用户看到的像是"这个框没分类"。这条单测就是防止再次漏收。
import { describe, expect, it } from "vitest"
import { CLASS_BEHAVIOR, MODEL_CLASSES, behaviorFor } from "@/modules/pdf-core/layout/decode"
import { CLASS_COLORS, FALLBACK_COLOR } from "../debug-panel"

describe("类别表覆盖模型全部类别", () => {
  it("每个模型类别都有行为映射（不落 skip 兜底）", () => {
    const missing = MODEL_CLASSES.filter((c) => CLASS_BEHAVIOR[c] === undefined)
    expect(missing).toEqual([])
  })

  it("每个模型类别都有配色（不落兜底色）", () => {
    const missing = MODEL_CLASSES.filter((c) => CLASS_COLORS[c] === undefined)
    expect(missing).toEqual([])
  })

  it("两张表的键集合一致（防只在一边加）", () => {
    expect(Object.keys(CLASS_BEHAVIOR).sort()).toEqual(Object.keys(CLASS_COLORS).sort())
  })

  it("表注跟随 caption 系列走翻译（2026-09-14 修复点）", () => {
    expect(behaviorFor("table_footnote")).toBe("translate")
  })

  it("未知类别仍走兜底：skip + 兜底色（供「这类还没收录」一眼可见）", () => {
    expect(behaviorFor("something_new")).toBe("skip")
    expect(CLASS_COLORS["something_new"]).toBeUndefined()
    expect(FALLBACK_COLOR).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
