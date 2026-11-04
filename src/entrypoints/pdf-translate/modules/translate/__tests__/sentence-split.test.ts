import { describe, expect, it } from "vitest"
import { splitBySentences, splitByRatio } from "../sentence-split"

describe("splitBySentences 句子扫描", () => {
  it("中文句末符无条件成句；引号后置并入前句", () => {
    expect(splitBySentences("第一句。第二句！他 said “go”。")).toEqual([
      "第一句。",
      "第二句！",
      "他 said “go”。",
    ])
  })
  it("英文句点只在 空白+实词（大写开头≥2小写）后成句：Fig. 1 / e.g. / 3.57% 不切", () => {
    expect(splitBySentences("see Fig. 1 and 3.57% e.g. items")).toEqual([
      "see Fig. 1 and 3.57% e.g. items",
    ])
    expect(splitBySentences("end of one. Next part starts")).toEqual([
      "end of one.",
      "Next part starts",
    ])
  })
  it("英文分号/问叹号按空白+实词规则", () => {
    expect(splitBySentences("is it so? Yes! it is")).toEqual(["is it so?", "Yes!", "it is"])
  })
})

describe("splitByRatio 按比例贪心", () => {
  it("切在离比例点最近的句边界", () => {
    // 4 句，比例 [0.5, 0.5] → 前两句/后两句
    const s = "甲。乙。丙。丁。"
    expect(splitByRatio(s, [0.5, 0.5])).toEqual(["甲。乙。", "丙。丁。"])
  })
  it("比例悬殊：切点落进第 1 句后", () => {
    const s = "甲乙丙丁戊己。庚辛。"
    expect(splitByRatio(s, [0.75, 0.25])).toEqual(["甲乙丙丁戊己。", "庚辛。"])
  })
  it("退化：整条只有一个句子 → 按字符比例硬切", () => {
    const out = splitByRatio("一句话没有句号分隔符", [0.5, 0.5])
    expect(out.join("")).toBe("一句话没有句号分隔符")
    expect(out[0]!.length).toBeGreaterThan(0)
    expect(out[1]!.length).toBeGreaterThan(0)
  })
  it("parts 译文总和不丢字", () => {
    const s = "第一句。第二句！第三句？第四句；"
    expect(splitByRatio(s, [0.3, 0.4, 0.3]).join("")).toBe(s)
  })
})
