// src/utils/updates/__tests__/feed.test.ts
import { describe, expect, it } from "vitest"
import {
  extractExtensionBannerItems,
  resolveUpdateLang,
  resolveUpdateUrl,
  UPDATES_PAGE_URL,
} from "../feed"

describe("updates feed utilities", () => {
  it("resolves zh and en locales", () => {
    expect(resolveUpdateLang("zh-CN")).toBe("zh")
    expect(resolveUpdateLang("zh_TW")).toBe("zh")
    expect(resolveUpdateLang("en-US")).toBe("en")
    expect(resolveUpdateLang("ja")).toBe("en")
  })

  it("resolves relative paths against netxmeow.top and blocks unsafe protocols", () => {
    expect(resolveUpdateUrl("/meowtabby/updates/banner.svg")).toBe(
      "https://netxmeow.top/meowtabby/updates/banner.svg",
    )
    expect(resolveUpdateUrl("https://netxmeow.top/meowtabby/updates/")).toBe(
      "https://netxmeow.top/meowtabby/updates/",
    )
    expect(resolveUpdateUrl("javascript:alert(1)")).toBeUndefined()
  })

  it("filters enabled extensionBanner items, sorts by order, and supports overrides", () => {
    const feed = {
      version: 1,
      pageUrl: UPDATES_PAGE_URL,
      items: [
        {
          id: "hidden-post",
          title: { zh: "隐藏", en: "Hidden" },
          summary: { zh: "不展示", en: "Not shown" },
          extensionBanner: { enabled: false },
        },
        {
          id: "second",
          title: { zh: "第二条", en: "Second" },
          summary: { zh: "第二条摘要", en: "Second summary" },
          image: "/meowtabby/updates/second.png",
          extensionBanner: { enabled: true, order: 2 },
        },
        {
          id: "first",
          title: { zh: "第一条完整标题", en: "First full title" },
          summary: { zh: "第一条完整摘要", en: "First full summary" },
          image: "/meowtabby/updates/first.png",
          extensionBanner: {
            enabled: true,
            order: 1,
            title: { zh: "自定义短标题", en: "Custom short title" },
            image: "/meowtabby/updates/first-banner.svg",
          },
        },
      ],
    }

    const zhItems = extractExtensionBannerItems(feed, "zh")
    expect(zhItems).toHaveLength(2)
    expect(zhItems[0]).toEqual({
      id: "first",
      title: "自定义短标题",
      summary: "第一条完整摘要",
      image: "https://netxmeow.top/meowtabby/updates/first-banner.svg",
      imageAlt: "第一条完整标题",
      url: "https://netxmeow.top/meowtabby/updates/#first",
    })
    expect(zhItems[1]).toEqual({
      id: "second",
      title: "第二条",
      summary: "第二条摘要",
      image: "https://netxmeow.top/meowtabby/updates/second.png",
      imageAlt: "第二条",
      url: "https://netxmeow.top/meowtabby/updates/#second",
    })

    const enItems = extractExtensionBannerItems(feed, "en")
    expect(enItems[0]?.title).toBe("Custom short title")
    expect(enItems[1]?.summary).toBe("Second summary")
  })
})
