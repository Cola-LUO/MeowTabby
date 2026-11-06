import type { ClusterLayoutResult } from "./cluster-layout"

/** 把求解结果写进译文框；溢出类仅用于统计，超出框的内容由 CSS 裁切。 */
export function applyClusterLayout(box: HTMLElement, layout: ClusterLayoutResult): void {
  const datasetSize = parseFloat(box.dataset.baseFontSize ?? "")
  const base = Number.isFinite(datasetSize) ? datasetSize : parseFloat(box.style.fontSize) || 10
  box.style.height = `${layout.height}px`
  box.style.fontSize = `${base * layout.scale}px`
  box.style.lineHeight = `${layout.lineHeight}`
  box.classList.toggle("trans-cluster--overflow", layout.overflow)
}
