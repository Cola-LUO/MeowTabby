/** URL 启发式：判断一个 tab URL 是否像 PDF。
 *  只做粗判：不覆盖的形态由 viewer 加载失败兜底（对照页会提示并给出打开按钮）。 */
export function looksLikePdfUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url)
    if (pathname.toLowerCase().endsWith(".pdf")) return true
    // arxiv 等站点的 /pdf/ 路由（https://arxiv.org/pdf/2401.00001v2）
    return pathname.includes("/pdf/")
  } catch {
    return false
  }
}
