import { describe, expect, it } from "vitest"
import { LEGACY_MODEL_SHA256, modelFingerprint, sliceMatchesModel } from "../slice-format"

describe("切片模型与预处理版本", () => {
  it("保留相同原模型的旧切片兼容性", () => {
    expect(sliceMatchesModel({}, LEGACY_MODEL_SHA256)).toBe(true)
  })
  it("更换模型时不复用缺少指纹的旧切片", () => {
    expect(sliceMatchesModel({}, "changed-model")).toBe(false)
  })
  it("新切片只有完整指纹一致才能复用", () => {
    const saved = { modelFingerprint: modelFingerprint(LEGACY_MODEL_SHA256) }
    expect(sliceMatchesModel(saved, LEGACY_MODEL_SHA256)).toBe(true)
    expect(sliceMatchesModel(saved, "changed-model")).toBe(false)
  })
  it("预处理或检测参数变化会使新切片失效", () => {
    expect(
      sliceMatchesModel(
        { modelFingerprint: `${LEGACY_MODEL_SHA256}:640:32:0.25:v1` },
        LEGACY_MODEL_SHA256,
      ),
    ).toBe(false)
  })
})
