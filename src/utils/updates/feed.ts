// src/utils/updates/feed.ts
import i18next from "i18next"

export const UPDATES_ORIGIN = "https://netxmeow.top"
export const UPDATES_PAGE_URL = `${UPDATES_ORIGIN}/meowtabby/updates/`
export const UPDATES_FEED_URL = `${UPDATES_ORIGIN}/meowtabby/updates/feed.json`
export const UPDATES_CACHE_KEY = "meowtabby:updates-feed:v1"

export type UpdateLang = "zh" | "en"

export interface LocalizedText {
  zh?: string
  en?: string
}

export interface UpdateExtensionBannerConfig {
  enabled: boolean
  order?: number
  title?: LocalizedText
  summary?: LocalizedText
  image?: string
  url?: string
}

export interface UpdateFeedItem {
  id: string
  publishedAt?: string
  tag?: LocalizedText
  title: LocalizedText
  summary: LocalizedText
  image?: string
  imageAlt?: LocalizedText
  extensionBanner?: UpdateExtensionBannerConfig
}

export interface UpdatesFeed {
  version: number
  pageUrl?: string
  items: UpdateFeedItem[]
}

export interface ExtensionBannerItem {
  id: string
  title: string
  summary: string
  image?: string
  imageAlt: string
  url: string
}

export function resolveUpdateLang(locale?: string): UpdateLang {
  const candidate =
    locale ||
    i18next.language ||
    (typeof navigator !== "undefined" ? navigator.language : "") ||
    "en"
  return candidate.toLowerCase().startsWith("zh") ? "zh" : "en"
}

function pickLocalizedText(text: LocalizedText | undefined, lang: UpdateLang): string {
  if (!text) return ""
  const preferred = lang === "zh" ? text.zh : text.en
  const fallback = lang === "zh" ? text.en : text.zh
  return (preferred || fallback || "").trim()
}

export function resolveUpdateUrl(
  rawUrl: string | undefined,
  base = UPDATES_ORIGIN,
): string | undefined {
  if (!rawUrl) return undefined
  const trimmed = rawUrl.trim()
  if (!trimmed) return undefined
  try {
    const resolved = new URL(trimmed, base)
    if (resolved.protocol !== "https:" && resolved.protocol !== "http:") {
      return undefined
    }
    return resolved.toString()
  } catch {
    return undefined
  }
}

export function extractExtensionBannerItems(
  feed: UpdatesFeed | null | undefined,
  lang: UpdateLang,
): ExtensionBannerItem[] {
  if (!feed || !Array.isArray(feed.items)) {
    return []
  }
  const pageUrl = resolveUpdateUrl(feed.pageUrl) ?? UPDATES_PAGE_URL

  return feed.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Boolean(item?.id && item.extensionBanner?.enabled))
    .sort((a, b) => {
      const orderA = a.item.extensionBanner?.order ?? Number.MAX_SAFE_INTEGER
      const orderB = b.item.extensionBanner?.order ?? Number.MAX_SAFE_INTEGER
      return orderA === orderB ? a.index - b.index : orderA - orderB
    })
    .map(({ item }) => {
      const banner = item.extensionBanner
      const title = pickLocalizedText(banner?.title ?? item.title, lang)
      const summary = pickLocalizedText(banner?.summary ?? item.summary, lang)
      const image = resolveUpdateUrl(banner?.image ?? item.image)
      const imageAlt = pickLocalizedText(item.imageAlt ?? item.title, lang) || title || "MeowTabby"
      const customUrl = resolveUpdateUrl(banner?.url)
      const url = customUrl ?? `${pageUrl}#${encodeURIComponent(item.id)}`

      return {
        id: item.id,
        title,
        summary,
        image,
        imageAlt,
        url,
      }
    })
    .filter((entry) => Boolean(entry.title || entry.summary))
}

export function readCachedUpdatesFeed(): UpdatesFeed | null {
  try {
    if (typeof localStorage === "undefined") return null
    const raw = localStorage.getItem(UPDATES_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as UpdatesFeed
    if (!parsed || !Array.isArray(parsed.items)) return null
    return parsed
  } catch {
    return null
  }
}

export function writeCachedUpdatesFeed(feed: UpdatesFeed): void {
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(UPDATES_CACHE_KEY, JSON.stringify(feed))
  } catch {
    // Ignore storage quota or restricted context errors
  }
}

export async function fetchUpdatesFeed(signal?: AbortSignal): Promise<UpdatesFeed | null> {
  try {
    const response = await fetch(UPDATES_FEED_URL, {
      cache: "no-cache",
      signal,
    })
    if (!response.ok) return null
    const parsed = (await response.json()) as UpdatesFeed
    if (!parsed || !Array.isArray(parsed.items)) return null
    writeCachedUpdatesFeed(parsed)
    return parsed
  } catch {
    return null
  }
}
