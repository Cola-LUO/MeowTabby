import type { PDFPageProxy } from "pdfjs-dist"

export interface PdfTextItem {
  str: string
  x: number
  /** 字形盒顶（PDF y-up）。pdf.js 的 transform[5] 是基线，统一上移 0.8·字高 */
  y: number
  w: number
  h: number
  fontName: string
  /** 是否为加粗字体（仅 true 时写入，保持向后兼容） */
  bold?: boolean
  /** 内容流序号：getTextContent 返回数组中的先后（过滤保序），阅读序 cid 的依据 */
  order: number
}

export interface PdfFontMeta {
  name?: string
  bold?: boolean
  black?: boolean
  fontFamily?: string
}

const BOLD_NAME_RE =
  /(?:bold|black|heavy|semibold|demibold|extrabold|ultrabold|(?<![a-z])demi(?![a-z])|(?<![a-z])medi(?:um)?(?![a-z])|cmbx|lmbx|ecbx|ptmb|phvb|simhei|heiti)/i

/** 判断 PDF 字体是否为粗体：优先看 pdf.js 字体元数据标志，再匹配真实字体名/字族。 */
export function isBoldFont(fontName: string, meta?: PdfFontMeta): boolean {
  if (meta?.bold === true || meta?.black === true) return true
  const candidates = [meta?.name, meta?.fontFamily, fontName]
  return candidates.some((s) => typeof s === "string" && s.length > 0 && BOLD_NAME_RE.test(s))
}

const ASCENT = 0.8

/** 同行需有足够纵向重叠；容许字高稍小的行内符号偏离正文基线。 */
export function sameTextLine(a: PdfTextItem, b: PdfTextItem): boolean {
  const minH = Math.min(a.h, b.h)
  const overlap = Math.min(a.y, b.y) - Math.max(a.y - a.h, b.y - b.h)
  const baselineDelta = Math.abs(a.y - ASCENT * a.h - (b.y - ASCENT * b.h))
  return overlap >= minH * 0.6 && baselineDelta <= Math.max(2, minH * 0.6)
}

export function normalizeItems(
  raw: Array<{
    str: string
    transform: number[]
    width: number
    height: number
    fontName?: string
  }>,
  _styles?: Record<string, { fontFamily?: string }>,
  origin: readonly number[] = [0, 0],
  fontLookup?: Record<string, PdfFontMeta>,
): PdfTextItem[] {
  const ox = origin[0] ?? 0
  const oy = origin[1] ?? 0
  const out: PdfTextItem[] = []
  for (const it of raw) {
    if (typeof it.str !== "string" || it.str.trim().length === 0) continue
    const t = it.transform
    if (Math.abs(t[1] ?? 0) > 0.01 || Math.abs(t[2] ?? 0) > 0.01) continue
    const fontName = it.fontName ?? ""
    const bold = isBoldFont(fontName, {
      fontFamily: _styles?.[fontName]?.fontFamily,
      ...fontLookup?.[fontName],
    })
    const item: PdfTextItem = {
      str: it.str,
      // getTextContent 的 transform 是原始 PDF user space；渲染 viewport 以 CropBox
      // 原点为基准（如 mediabox [0,-8,612,792]），这里同步平移，否则文本框整体偏移
      x: (t[4] ?? 0) - ox,
      y: (t[5] ?? 0) - oy + ASCENT * (it.height ?? 0),
      w: it.width ?? 0,
      h: it.height ?? 0,
      fontName,
      order: out.length,
    }
    if (bold) item.bold = true
    out.push(item)
  }
  // small-caps 等场景把单词拆成紧邻单字符 item，预合并避免拦腰截断
  const mergedOut: PdfTextItem[] = []
  for (const it of out) {
    const prev = mergedOut[mergedOut.length - 1]
    if (
      prev &&
      prev.fontName === it.fontName &&
      prev.str.length === 1 &&
      prev.h >= it.h &&
      sameTextLine(prev, it) &&
      it.x - (prev.x + prev.w) >= -0.2 * Math.min(prev.w, it.w) &&
      it.x - (prev.x + prev.w) <= 1.5 &&
      !/\s/.test(it.str)
    ) {
      const left = Math.min(prev.x, it.x)
      const right = Math.max(prev.x + prev.w, it.x + it.w)
      const bottom = Math.min(prev.y - prev.h, it.y - it.h)
      prev.str += it.str
      prev.x = left
      prev.w = right - left
      prev.y = Math.max(prev.y, it.y)
      prev.h = prev.y - bottom
      continue
    }
    mergedOut.push(it)
  }
  return mergedOut
}

interface PageObjPool {
  has?: (name: string) => boolean
  get?: (name: string) => unknown
}

function readFontFromPool(
  pool: PageObjPool | undefined,
  fontName: string,
): PdfFontMeta | undefined {
  if (!pool?.has?.(fontName) || typeof pool.get !== "function") return undefined
  try {
    const obj = pool.get(fontName) as { name?: unknown; bold?: unknown; black?: unknown } | null
    if (!obj || typeof obj !== "object") return undefined
    const meta: PdfFontMeta = {}
    if (typeof obj.name === "string") meta.name = obj.name
    if (typeof obj.bold === "boolean") meta.bold = obj.bold
    if (typeof obj.black === "boolean") meta.black = obj.black
    return meta
  } catch {
    return undefined
  }
}

export function readPageFont(page: PDFPageProxy, fontName: string): PdfFontMeta | undefined {
  const p = page as unknown as { commonObjs?: PageObjPool; objs?: PageObjPool }
  return readFontFromPool(p.commonObjs, fontName) ?? readFontFromPool(p.objs, fontName)
}

export async function getTextItems(page: PDFPageProxy): Promise<PdfTextItem[]> {
  const content = await page.getTextContent()
  const rawItems = content.items as Array<{
    str: string
    transform: number[]
    width: number
    height: number
    fontName?: string
  }>
  const fontLookup: Record<string, PdfFontMeta> = {}
  for (const it of rawItems) {
    const name = it.fontName
    if (!name || name in fontLookup) continue
    const meta = readPageFont(page, name)
    if (meta) fontLookup[name] = meta
  }
  // page.view = CropBox [x0, y0, x1, y1]；pdf.js viewport 以它为可见页基准，
  // 文本 user space 坐标需先减去原点才能与渲染/YOLO 框对齐
  return normalizeItems(rawItems, content.styles, page.view, fontLookup)
}
