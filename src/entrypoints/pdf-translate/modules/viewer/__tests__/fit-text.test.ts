/** 合并组译文按容量分配（2026-09-16 建；2026-09-17 改为**字符级**）
 *  锁住用户口径：① 顺序填充（先填前面的）；② 后盒硬容量，装得下才拿（绝不撑高）；
 *  ③ 其余全部给前盒；④ 都放不下 → 整组统一缩字号，绝不截断、绝不零字。
 *  粒度：字符（用户 2026-09-17 明确接受"把句子劈开"——切分只在显示层，送翻仍是整条）。 */
import { describe, expect, it } from "vitest"
import {
  MIN_CHARS,
  SCALE_STEPS,
  allocateChars,
  maxChars,
  softenCutPoints,
  splitByCapacity,
  type PartBox,
} from "../fit-text"

/** 盒：宽 width（CSS px）、可用高 availHeight（前盒可含下吃空间）、盒内字号 fontSize
 *  （= renderBlocks 已乘 0.9 后的值；单行高 = fontSize × 1.3） */
const part = (width: number, availHeight: number, fontSize = 10): PartBox => ({
  width,
  availHeight,
  fontSize,
})

const TEXT = "第一句内容。第二句内容。第三句内容。" // 18 字

describe("SCALE_STEPS：缩字号档位", () => {
  it("等比档位，下限约 0.6", () => {
    expect(SCALE_STEPS).toEqual([1, 0.9, 0.81, 0.73, 0.66])
  })
})

describe("maxChars：二分求可容纳字符数", () => {
  it("100px 宽 / 1 行 → 10 个中文字；ASCII 按半宽 → 18 个", () => {
    expect(maxChars("中".repeat(50), part(100, 13), 1)).toBe(10)
    expect(maxChars("a".repeat(50), part(100, 13), 1)).toBe(18)
  })

  it("文本比容量短 → 返回文本长度（不虚报容量）", () => {
    expect(maxChars("甲乙丙", part(100, 13), 1)).toBe(3)
  })

  it("档位越小能放越多（字号 × scale）", () => {
    expect(maxChars("中".repeat(50), part(100, 13), 0.9)).toBeGreaterThanOrEqual(10)
  })
})

describe("allocateChars：保底 + 前盒吃满 + 末盒拿剩余", () => {
  it("末盒容量远大于剩余 → 前盒只吃到'给后面留够保底'为止", () => {
    // caps 前盒 18（文本只有 18 字）、末盒 10（其容量不参与分配）；total 18 → [14, 4]
    expect(allocateChars(18, [18, 10], 4)).toEqual([14, 4])
  })

  it("Σ = total（不丢字）", () => {
    expect(allocateChars(37, [30, 30, 30], 4).reduce((a, b) => a + b, 0)).toBe(37)
  })

  it("每盒至少 minChars（total 够时）", () => {
    const c = allocateChars(37, [30, 30, 30], 4)
    expect(Math.min(...c)).toBeGreaterThanOrEqual(4)
  })

  it("total < minChars × 盒数 → 均分退化，不产生负数", () => {
    const c = allocateChars(3, [10, 10, 10], 4)
    expect(c.every((v) => v >= 0)).toBe(true)
    expect(c.reduce((a, b) => a + b, 0)).toBe(3)
  })
})

describe("softenCutPoints：切点左移到标点/空格", () => {
  it("中文回退到最近标点（只左移，Σ 不变）", () => {
    // 14 落在"第三句"内部 → 回退到"。"之后（第 12 字）
    const counts = softenCutPoints(TEXT, [14, 4], MIN_CHARS)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(TEXT.length)
    expect(TEXT.slice(0, counts[0])).toBe("第一句内容。第二句内容。")
  })

  it("拉丁文回退到空格（不劈词）", () => {
    const t = "First sentence here. Second sentence here."
    const counts = softenCutPoints(t, [25, t.length - 25], MIN_CHARS)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(t.length)
    expect(counts[0]).toBe(21) // 回退到"here. "之后
    expect(t[counts[0]! - 1]).toBe(" ") // 前盒以空格收尾 = 没劈词
  })

  it("软化不得把任一盒压到 minChars 以下", () => {
    const counts = softenCutPoints(TEXT, [5, 13], MIN_CHARS)
    expect(counts[0]!).toBeGreaterThanOrEqual(MIN_CHARS)
  })
})

describe("splitByCapacity：四条约定的口径", () => {
  it("① 顺序填充 ③ 其余全部给前盒：档位 1 成功，前盒吃满、末盒拿剩余", () => {
    const r = splitByCapacity(TEXT, [part(200, 200), part(100, 13)])
    expect(r.scale).toBe(1)
    expect(r.pieces.join("")).toBe(TEXT)
    expect(r.pieces[0]!.length).toBeGreaterThan(r.pieces[1]!.length)
  })

  it("② 后盒硬容量：末盒拿到的量不超过其容量", () => {
    const r = splitByCapacity(TEXT, [part(200, 200), part(100, 13)])
    expect(r.pieces[1]!.length).toBeLessThanOrEqual(10)
  })

  it("② 降档生效：末盒硬容量装不下剩余量 → scale < 1", () => {
    // 前盒 120px/1 行 = 12 字（吃不满）；末盒 55px/1 行 = 5 字，而剩余 6 字 → 档位 1 失败
    const r = splitByCapacity(TEXT, [part(120, 13), part(55, 13)])
    expect(r.scale).toBeLessThan(1)
    expect(r.pieces.join("")).toBe(TEXT)
  })

  it("④ 总容量不足 → 比例兜底 + 下限档，不截断不零字", () => {
    const r = splitByCapacity(TEXT, [part(20, 13), part(20, 13)])
    expect(r.scale).toBe(SCALE_STEPS[SCALE_STEPS.length - 1]!)
    expect(r.pieces.every((p) => p.length > 0)).toBe(true)
    expect(r.pieces.join("")).toBe(TEXT)
  })

  it("保真：任意档位/盒宽下各份拼接 = 原译文", () => {
    for (const w of [40, 60, 100, 200]) {
      expect(splitByCapacity(TEXT, [part(200, 200), part(w, 13)]).pieces.join("")).toBe(TEXT)
    }
  })

  it("空译文 → 各份皆空串；单盒（part 数为 1）→ 整条给该盒", () => {
    expect(splitByCapacity("", [part(200, 200), part(100, 13)]).pieces).toEqual(["", ""])
    expect(splitByCapacity(TEXT, [part(200, 200)]).pieces).toEqual([TEXT])
  })
})
