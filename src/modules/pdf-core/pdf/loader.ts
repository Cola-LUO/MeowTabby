import * as pdfjs from "pdfjs-dist"
import { extUrl } from "../env"

export type PDFDocumentProxy =
  Awaited<ReturnType<typeof pdfjs.getDocument>>["promise"] extends Promise<infer T> ? T : never

pdfjs.GlobalWorkerOptions.workerSrc = extUrl("pdf.worker.min.mjs")

export async function loadPdf(url: string) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`PDF 加载失败：HTTP ${resp.status}（${url}）`)
  const data = await resp.arrayBuffer()
  return pdfjs.getDocument({
    data,
    cMapUrl: extUrl("cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: extUrl("standard_fonts/"),
  }).promise
}
