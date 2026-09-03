import { Icon } from "@iconify/react"
import { useState } from "react"
import meowLogo from "@/assets/icons/read-frog.png?url"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/base-ui/popover"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/base-ui/sidebar"
import { i18n } from "@/utils/i18n"

export function WhatsNewFooter() {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SidebarMenu>
        <SidebarMenuItem>
          <PopoverTrigger
            render={
              <SidebarMenuButton
                aria-label={i18n.t("options.whatsNew.title")}
                tooltip={i18n.t("options.whatsNew.title")}
              />
            }
          >
            <Icon icon="fluent:clipboard-chat-empty-24-regular" />
            <span>{i18n.t("options.whatsNew.title")}</span>
          </PopoverTrigger>
        </SidebarMenuItem>
      </SidebarMenu>

      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-[min(24rem,calc(100vw-2rem))] gap-4 p-3"
      >
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg bg-[#009999] px-4 py-5">
          <img src={meowLogo} alt="MeowTabby" className="size-12 object-contain" />
          <span className="text-base font-semibold text-white">MeowTabby</span>
        </div>
        <p className="px-1 text-justify text-sm leading-relaxed text-muted-foreground">
          {i18n.t("options.whatsNew.description")}
        </p>
      </PopoverContent>
    </Popover>
  )
}
