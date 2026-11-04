import type { PDFPageProxy } from "pdfjs-dist"

export const RENDER_SCALE = Math.min(
  (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) * 2,
  3,
)

/** 渲染整页到 canvas（位图 = viewport×scale）；返回 CSS 尺寸（scale=1） */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<{ width: number; height: number }> {
  const vp = page.getViewport({ scale })
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  const ctx = canvas.getContext("2d")!
  await page.render({ canvasContext: ctx, viewport: vp }).promise
  const vp1 = page.getViewport({ scale: 1 })
  return { width: vp1.width, height: vp1.height }
}
