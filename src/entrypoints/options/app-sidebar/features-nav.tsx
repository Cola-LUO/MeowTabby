import { Icon } from "@iconify/react"
import { Link, useLocation } from "react-router"
import { browser } from "#imports"
import { NewBadge } from "@/components/badges/new-badge"
import { PdfIcon } from "@/components/pdf-icon"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/base-ui/sidebar"
import { TRANSLATION_HUB_PAGE_PATH } from "@/utils/constants/translation-hub"
import { i18n } from "@/utils/i18n"

export function FeaturesNav() {
  const { pathname } = useLocation()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{i18n.t("options.sidebar.features")}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/pdf-translate" />}
              isActive={pathname === "/pdf-translate"}
              tooltip={i18n.t("options.tools.pdfTranslate")}
            >
              <PdfIcon className="size-4" />
              <span>{i18n.t("options.tools.pdfTranslate")}</span>
              <NewBadge size="sm" className="-ml-1 -translate-y-1 bg-[#FFA72B] text-[#3D2500]" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/tts" />}
              isActive={pathname === "/tts"}
              tooltip={i18n.t("options.tts.title")}
            >
              <Icon icon="tabler:speakerphone" />
              <span>{i18n.t("options.tts.title")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <a
                  href={browser.runtime.getURL(TRANSLATION_HUB_PAGE_PATH)}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              tooltip={i18n.t("options.tools.translationHub")}
            >
              <Icon icon="tabler:language-hiragana" />
              <span>{i18n.t("options.tools.translationHub")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
