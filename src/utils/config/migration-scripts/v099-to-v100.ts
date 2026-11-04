/**
 * Migration script from v099 to v100.
 *
 * Adds the `pdfTranslation` feature node (PDF 对照翻译, 合拢自 web_pdf_trans)，
 * defaulting to the same provider selection as `pageTranslation` — the PDF
 * feature follows the page-translation default the user already had.
 *
 * IMPORTANT: This is a frozen snapshot. All values and helpers are deliberately inline and it
 * imports nothing from the evolving application code.
 */

function isObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function migrate(oldConfig: any): any {
  if (!isObject(oldConfig)) return oldConfig

  const config = structuredClone(oldConfig)

  if (!isObject(config.pdfTranslation) && isObject(config.pageTranslation)) {
    config.pdfTranslation = structuredClone(config.pageTranslation)
  }

  return config
}
