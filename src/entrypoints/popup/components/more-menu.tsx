import { Icon } from "@iconify/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/base-ui/dropdown-menu"
import { i18n } from "@/utils/i18n"

const SUPPORT_EMAIL = "luofchn@outlook.com"

function openLink(url: string) {
  window.open(url, "_blank", "noopener,noreferrer")
}

export function MoreMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-300 dark:hover:bg-neutral-700"
          />
        }
      >
        <Icon icon="tabler:dots" className="size-4" strokeWidth={1.6} />
        <span className="text-[13px] font-medium">{i18n.t("popup.more.title")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-fit">
        <DropdownMenuItem onClick={() => openLink("/open-source.html")} className="cursor-pointer">
          <Icon icon="tabler:scale" className="size-4" strokeWidth={1.6} />
          {i18n.t("popup.more.openSource")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => openLink(`mailto:${SUPPORT_EMAIL}`)}
          className="cursor-pointer"
        >
          <Icon icon="tabler:mail" className="size-4" strokeWidth={1.6} />
          {i18n.t("popup.more.emailUs")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
