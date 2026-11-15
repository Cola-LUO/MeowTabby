// 旧切片的渲染输入可能包含 PDF 批注，不再复用。
export const LEGACY_MODEL_SHA256 =
  "fece9af02f618b603ff7921ccec6861d13e7e1f9830e091dfb7e8ad9311e5b21"
export function modelFingerprint(modelHash: string): string {
  return `${modelHash}:1024:32:0.25:v2`
}
export function sliceMatchesModel(
  saved: { modelFingerprint?: string },
  modelHash: string,
): boolean {
  return saved.modelFingerprint === modelFingerprint(modelHash)
}
