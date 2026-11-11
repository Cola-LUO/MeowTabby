import { browser } from "#imports"
import { PdfIcon } from "@/components/pdf-icon"
import { Button } from "@/components/ui/base-ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/base-ui/tooltip"
import {
  PDF_TRANSLATE_OPTIONS_ROUTE,
  PDF_TRANSLATE_PAGE_PATH,
} from "@/utils/constants/pdf-translate"
import { i18n } from "@/utils/i18n"
import { openOptionsPage } from "@/utils/navigation"
import { looksLikePdfUrl } from "@/utils/pdf-detect"

export function PdfTranslateButton() {
  const handleClick = async () => {
    const viewerUrl = browser.runtime.getURL(PDF_TRANSLATE_PAGE_PATH)
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    // PDF 页直达对照翻译；其他页打开设置页并定位到「PDF 翻译」入口分页。
    // 不带 to 参数 → 目标语走扩展自己的设置（与其他功能默认一致）。
    if (tab?.url && looksLikePdfUrl(tab.url)) {
      await browser.tabs.create({ url: `${viewerUrl}?url=${encodeURIComponent(tab.url)}` })
      return
    }
    await openOptionsPage({ route: PDF_TRANSLATE_OPTIONS_ROUTE })
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={handleClick} />}>
        <span className="inline-flex h-5 items-center justify-center rounded-full bg-[#FFA72B] px-1.5 text-[#3D2500]">
          <PdfIcon className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[200px] text-wrap">
        {i18n.t("popup.pdfTranslate.tooltip")}
      </TooltipContent>
    </Tooltip>
  )
}
