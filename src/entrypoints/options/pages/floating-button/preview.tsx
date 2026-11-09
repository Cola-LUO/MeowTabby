import { RiTranslate } from "@remixicon/react"
import { IconLockOpen, IconMessageCircle, IconX } from "@tabler/icons-react"
import { Search, Settings } from "lucide-react"
import meowLogo from "@/assets/icons/meowtabby.png?url&no-inline"
import { i18n } from "@/utils/i18n"

export function FloatingButtonPreview() {
  return (
    <div
      role="img"
      aria-label={i18n.t("options.floatingButton.demoImageAlt")}
      className="mx-6 w-100 min-w-0 overflow-hidden rounded-xl border border-border/60 bg-background/70 shadow-lg"
    >
      <div
        aria-hidden="true"
        className="flex h-10 items-center gap-4 border-b border-border/50 bg-muted/70 px-3"
      >
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex h-6 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-border/40 bg-background/80 text-muted-foreground">
          <Search className="size-3" />
          <span className="truncate text-[10px]">example.com</span>
        </div>
      </div>
      <div aria-hidden="true" className="flex h-54 items-center justify-end">
        <div className="flex flex-col items-end gap-2 pl-6">
          <span className="mr-2 rounded-full border border-border bg-white p-1.5 text-neutral-600 shadow-lg dark:bg-neutral-900 dark:text-neutral-400">
            <RiTranslate aria-hidden="true" className="size-5" />
          </span>
          <div className="relative">
            <div className="flex h-10 w-11 items-center rounded-l-full border border-r-0 border-border bg-white shadow-lg dark:bg-neutral-900">
              <img src={meowLogo} alt="" className="ml-1 size-8 rounded-full" />
            </div>
            <span className="absolute -top-1 -left-6 flex size-6 items-center justify-center text-neutral-300 dark:text-neutral-700">
              <IconX aria-hidden="true" className="size-3" strokeWidth={3} />
            </span>
            <span className="absolute -bottom-1 -left-6 flex size-6 items-center justify-center text-neutral-300 dark:text-neutral-700">
              <IconLockOpen aria-hidden="true" className="size-3" strokeWidth={3} />
            </span>
          </div>
          <span className="mr-2 rounded-full border border-border bg-white p-1.5 text-neutral-600 shadow-lg dark:bg-neutral-900 dark:text-neutral-400">
            <Settings aria-hidden="true" className="size-5" />
          </span>
          <span className="mr-2 rounded-full border border-border bg-white p-1.5 text-neutral-600 shadow-lg dark:bg-neutral-900 dark:text-neutral-400">
            <IconMessageCircle aria-hidden="true" className="size-5" />
          </span>
        </div>
      </div>
    </div>
  )
}
