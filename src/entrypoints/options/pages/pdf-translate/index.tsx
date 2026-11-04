import { useRef } from "react"
import { browser } from "#imports"
import { Button } from "@/components/ui/base-ui/button"
import { PDF_TRANSLATE_PAGE_PATH, PDF_TRANSLATE_SLOT_PARAM } from "@/utils/constants/pdf-translate"
import { i18n } from "@/utils/i18n"
import { putPdfSlot } from "@/utils/pdf-slot"
import { PageLayout } from "../../components/page-layout"

/** 「PDF 翻译」入口分页：引导态（标题 + 提示 + 打开 PDF）。
 *  选完文件经 IndexedDB 一次性槽位转交独立 viewer 页（blob URL 跨导航会失效），
 *  viewer 内的识别 / 翻译 / 导出逻辑全部不变。 */
export function PdfTranslatePage() {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    const key = await putPdfSlot(file)
    const viewerUrl = browser.runtime.getURL(PDF_TRANSLATE_PAGE_PATH)
    await browser.tabs.create({
      url: `${viewerUrl}?${PDF_TRANSLATE_SLOT_PARAM}=${encodeURIComponent(key)}`,
    })
  }

  return (
    <PageLayout
      title={i18n.t("pdfTranslate.blankHintTitle")}
      description={<span className="whitespace-pre-line">{i18n.t("pdfTranslate.blankHint")}</span>}
      innerClassName="flex justify-center"
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={() => {
          const file = inputRef.current?.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      <Button
        variant="outline"
        className="h-[50px] w-[280px] rounded-3xl border-dashed border-brand bg-brand/8 px-[25px] py-[7px] hover:bg-brand/14 dark:border-brand dark:bg-brand/12 dark:hover:bg-brand/20"
        onClick={() => inputRef.current?.click()}
      >
        <span className="text-sm">{i18n.t("pdfTranslate.openFile")}</span>
      </Button>
    </PageLayout>
  )
}
