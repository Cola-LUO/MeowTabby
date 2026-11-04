// 旧格式无模型字段：只在同一模型/1024输入/stride32/conf0.25时沿用。
export const LEGACY_MODEL_SHA256 =
  "fece9af02f618b603ff7921ccec6861d13e7e1f9830e091dfb7e8ad9311e5b21"
export function modelFingerprint(modelHash: string): string {
  return `${modelHash}:1024:32:0.25:v1`
}
export function sliceMatchesModel(
  saved: { modelFingerprint?: string },
  modelHash: string,
): boolean {
  return saved.modelFingerprint !== undefined
    ? saved.modelFingerprint === modelFingerprint(modelHash)
    : modelHash === LEGACY_MODEL_SHA256
}
