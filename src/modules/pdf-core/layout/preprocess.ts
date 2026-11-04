/** 与 BabelDOC resize_and_pad_image 一致的几何参数：等比缩放 + stride 对称补边 */
export function letterbox(srcW: number, srcH: number, dstSize: number, stride: number) {
  const scale = Math.min(dstSize / srcW, dstSize / srcH)
  const align = (v: number) => Math.round(v / stride) * stride
  const resizedW = align(srcW * scale)
  const resizedH = align(srcH * scale)
  const padW = dstSize - resizedW
  const padH = dstSize - resizedH
  return { scale, padX: padW, padY: padH, resizedW, resizedH }
}
