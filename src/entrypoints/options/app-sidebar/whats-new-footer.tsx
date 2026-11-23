import type { ExtensionBannerItem, UpdatesFeed } from "@/utils/updates/feed"
import { Icon } from "@iconify/react"
import { IconArrowUpRight, IconChevronLeft, IconChevronRight } from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
import meowLogo from "@/assets/icons/meowtabby.png?url"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/base-ui/popover"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/base-ui/sidebar"
import { i18n } from "@/utils/i18n"
import {
  extractExtensionBannerItems,
  fetchUpdatesFeed,
  readCachedUpdatesFeed,
  resolveUpdateLang,
  UPDATES_PAGE_URL,
} from "@/utils/updates/feed"

const CAROUSEL_INTERVAL_MS = 6000

export function WhatsNewFooter() {
  const [open, setOpen] = useState(false)
  const [paused, setPaused] = useState(false)
  const [feed, setFeed] = useState<UpdatesFeed | null>(() => readCachedUpdatesFeed())
  const [activeIndex, setActiveIndex] = useState(0)
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const controller = new AbortController()
    void fetchUpdatesFeed(controller.signal).then((fresh) => {
      if (fresh) {
        setFeed(fresh)
      }
    })
    return () => controller.abort()
  }, [])

  const lang = resolveUpdateLang()

  const fallbackItem = useMemo<ExtensionBannerItem>(
    () => ({
      id: "fallback",
      title: i18n.t("options.whatsNew.title"),
      summary: i18n.t("options.whatsNew.description"),
      imageAlt: "MeowTabby",
      url: UPDATES_PAGE_URL,
    }),
    [],
  )

  const items = useMemo(() => {
    const remoteItems = extractExtensionBannerItems(feed, lang)
    return remoteItems.length > 0 ? remoteItems : [fallbackItem]
  }, [feed, lang, fallbackItem])

  const safeIndex = activeIndex < items.length ? activeIndex : 0
  const currentItem = items[safeIndex] ?? fallbackItem
  const hasMultiple = items.length > 1

  useEffect(() => {
    if (!open || !hasMultiple || paused) return undefined
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % items.length)
    }, CAROUSEL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [open, hasMultiple, paused, items.length])

  const triggerTitle = i18n.t("options.whatsNew.trigger")
  const showRemoteImage = Boolean(currentItem.image && !failedImages[currentItem.image])

  const goPrev = () => {
    setActiveIndex((prev) => (prev - 1 + items.length) % items.length)
  }

  const goNext = () => {
    setActiveIndex((prev) => (prev + 1) % items.length)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SidebarMenu>
        <SidebarMenuItem>
          <PopoverTrigger
            render={<SidebarMenuButton aria-label={triggerTitle} tooltip={triggerTitle} />}
          >
            <Icon icon="fluent:clipboard-chat-empty-24-regular" />
            <span className="truncate">{triggerTitle}</span>
          </PopoverTrigger>
        </SidebarMenuItem>
      </SidebarMenu>

      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-[min(24rem,calc(100vw-2rem))] gap-3 p-3"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <a
          href={currentItem.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex flex-col gap-3 rounded-lg transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {showRemoteImage ? (
            <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/30">
              <img
                src={currentItem.image}
                alt={currentItem.imageAlt}
                className="block h-32 w-full object-cover"
                onError={() => {
                  const src = currentItem.image
                  if (!src) return
                  setFailedImages((prev) => ({ ...prev, [src]: true }))
                }}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg bg-[#FFE4C1] px-4 py-5">
              <img src={meowLogo} alt="MeowTabby" className="size-12 object-contain" />
              <span className="text-base font-semibold text-[#3D2608]">MeowTabby</span>
            </div>
          )}

          <div className="space-y-1.5 px-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                {currentItem.title}
              </span>
              <IconArrowUpRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
              />
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{currentItem.summary}</p>
          </div>
        </a>

        {hasMultiple && (
          <div className="flex items-center justify-between border-t border-border/60 pt-2">
            <div className="flex items-center gap-1.5">
              {items.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`${idx + 1} / ${items.length}`}
                  onClick={() => setActiveIndex(idx)}
                  className={
                    idx === safeIndex
                      ? "h-1.5 w-4 rounded-full bg-foreground transition-all"
                      : "size-1.5 rounded-full bg-muted-foreground/35 transition-all hover:bg-muted-foreground/60"
                  }
                />
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous"
                onClick={goPrev}
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <IconChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Next"
                onClick={goNext}
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <IconChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
