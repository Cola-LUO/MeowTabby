import type { ClusterLayoutResult } from "./cluster-layout"

/** 把求解结果写进簇盒（DOM 薄层，无逻辑）。
 *
 *  溢出兜底：盒子 overflow:hidden（由 viewer.css 保证）→ 溢出时挂
 *  `.trans-cluster--overflow`（盒内滚动）+ 全盒 `.linear-mask` 底部渐变提示。
 *  与溢出时背景转透明的做法不同，本项目必须保留白底盖住 canvas 上的英文。 */
export function applyClusterLayout(box: HTMLElement, layout: ClusterLayoutResult): void {
  const datasetSize = parseFloat(box.dataset.baseFontSize ?? "")
  const base = Number.isFinite(datasetSize) ? datasetSize : parseFloat(box.style.fontSize) || 10
  box.style.height = `${layout.height}px`
  box.style.fontSize = `${base * layout.scale}px`
  box.style.lineHeight = `${layout.lineHeight}`
  box.classList.toggle("trans-cluster--overflow", layout.overflow)
  const mask = box.querySelector<HTMLElement>(":scope > .linear-mask")
  if (layout.overflow) {
    if (!mask) {
      const el = box.ownerDocument.createElement("div")
      el.className = "linear-mask"
      box.appendChild(el)
    }
  } else if (mask) {
    mask.remove()
  }
}
