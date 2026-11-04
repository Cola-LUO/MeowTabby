export const PDF_TRANSLATE_PAGE_PATH = "/pdf-translate.html"

/** 设置页「PDF 翻译」入口分页的内部路由（options 页是 HashRouter；openOptionsPage 的 route 契约不带 #，由它拼上） */
export const PDF_TRANSLATE_OPTIONS_ROUTE = "/pdf-translate"

/** 设置页 → viewer 的一次性 PDF 文件槽位参数名（IndexedDB，见 utils/pdf-slot.ts） */
export const PDF_TRANSLATE_SLOT_PARAM = "slot"
