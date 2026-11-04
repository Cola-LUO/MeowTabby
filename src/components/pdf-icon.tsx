/** PDF 翻译入口图标（合拢计划第 1 条指定的 tabler file-pdf 图标，
 *  合拢计划中以 base64 data URI 提供；这里用内联 SVG 等价还原，
 *  fill="currentColor" 以跟随明暗主题。 */
export function PdfIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M0 0h256v256H0z" fill="none" />
      <path
        fill="currentColor"
        d="M222 152a6 6 0 0 1-6 6h-26v20h18a6 6 0 0 1 0 12h-18v18a6 6 0 0 1-12 0v-56a6 6 0 0 1 6-6h32a6 6 0 0 1 6 6M90 172a26 26 0 0 1-26 26H54v10a6 6 0 0 1-12 0v-56a6 6 0 0 1 6-6h16a26 26 0 0 1 26 26m-12 0a14 14 0 0 0-14-14H54v28h10a14 14 0 0 0 14-14m84 8a34 34 0 0 1-34 34h-16a6 6 0 0 1-6-6v-56a6 6 0 0 1 6-6h16a34 34 0 0 1 34 34m-12 0a22 22 0 0 0-22-22h-10v44h10a22 22 0 0 0 22-22M42 112V40a14 14 0 0 1 14-14h96a6 6 0 0 1 4.25 1.76l56 56A6 6 0 0 1 214 88v24a6 6 0 0 1-12 0V94h-50a6 6 0 0 1-6-6V38H56a2 2 0 0 0-2 2v72a6 6 0 0 1-12 0m116-30h35.52L158 46.48Z"
      />
    </svg>
  )
}
