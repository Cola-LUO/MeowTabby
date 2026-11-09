import { Icon } from "@iconify/react"
import { Link, useLocation } from "react-router"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/base-ui/collapsible"
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/base-ui/sidebar"
import { i18n } from "@/utils/i18n"

const OVERLAY_TOOLS_PATHS = ["/floating-button", "/selection-toolbar", "/context-menu"] as const
const FEATURE_SETTINGS = [
  { path: "/shortcuts", title: "options.shortcuts.title", icon: "tabler:command" },
  { path: "/page-translation", title: "options.translation.title", icon: "ri:translate" },
  { path: "/input-translation", title: "options.inputTranslation.title", icon: "tabler:keyboard" },
  { path: "/video-subtitles", title: "options.videoSubtitles.title", icon: "tabler:subtitles" },
] as const

export function FeatureSettingsNav() {
  const { pathname } = useLocation()
  const isOverlayToolsActive = OVERLAY_TOOLS_PATHS.includes(pathname)
  const isActive =
    isOverlayToolsActive ||
    pathname === "/custom-actions" ||
    FEATURE_SETTINGS.some(({ path }) => pathname === path || pathname.startsWith(`${path}/`))

  return (
    <SidebarMenuItem>
      <Collapsible defaultOpen={false} className="group/feature-settings">
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              isActive={isActive}
              tooltip={i18n.t("options.sidebar.featureSettings")}
            />
          }
        >
          <Icon icon="tabler:settings" />
          <span>{i18n.t("options.sidebar.featureSettings")}</span>
          <Icon
            icon="tabler:chevron-right"
            className="ml-auto transition-transform duration-200 group-data-open/feature-settings:rotate-90"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {FEATURE_SETTINGS.map(({ path, title, icon }) => (
              <SidebarMenuSubItem key={path}>
                <SidebarMenuSubButton
                  render={<Link to={path} />}
                  isActive={pathname === path || pathname.startsWith(`${path}/`)}
                >
                  <Icon icon={icon} />
                  <span>{i18n.t(title)}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
            <SidebarMenuSubItem>
              <Collapsible defaultOpen={isOverlayToolsActive} className="group/collapsible">
                <CollapsibleTrigger
                  render={
                    <SidebarMenuSubButton
                      render={<button type="button" />}
                      isActive={isOverlayToolsActive}
                      className="w-full"
                    />
                  }
                >
                  <Icon icon="tabler:layers-intersect" />
                  <span>{i18n.t("options.overlayTools.title")}</span>
                  <Icon
                    icon="tabler:chevron-right"
                    className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        render={<Link to="/floating-button" />}
                        isActive={pathname === "/floating-button"}
                      >
                        <span>{i18n.t("options.floatingButton.title")}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        render={<Link to="/selection-toolbar" />}
                        isActive={pathname === "/selection-toolbar"}
                      >
                        <span>{i18n.t("options.selectionToolbar.title")}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        render={<Link to="/context-menu" />}
                        isActive={pathname === "/context-menu"}
                      >
                        <span>{i18n.t("options.contextMenu.title")}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuSubItem>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                render={<Link to="/custom-actions" />}
                isActive={pathname === "/custom-actions"}
              >
                <Icon icon="tabler:sparkles" />
                <span>{i18n.t("options.selectionToolbar.customActions.title")}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
}
