import { describe, expect, it } from "vitest"
import { getProviderHeadersWithOverride } from "../headers"

describe("provider headers", () => {
  it("sends the user's own headers for a provider with none forced", () => {
    expect(getProviderHeadersWithOverride("openai", { "X-Test": "1" })).toEqual({
      "X-Test": "1",
    })
  })

  it("sends nothing when a provider with none forced has no configured headers", () => {
    expect(getProviderHeadersWithOverride("openai", undefined)).toBeUndefined()
    expect(getProviderHeadersWithOverride("openai", {})).toBeUndefined()
  })

  it("filters empty and non-string header values", () => {
    expect(
      getProviderHeadersWithOverride("openai", {
        "X-Empty": "",
        "X-Count": 1,
        "X-Test": "1",
      }),
    ).toEqual({
      "X-Test": "1",
    })
  })

  describe("forced headers", () => {
    // OpenRouter 的归因头（HTTP-Referer / X-OpenRouter-Title）随 2026-09-26 上游域名清理一并删除：
    // 它们只喂 OpenRouter 的应用排行榜，且 Referer 指向上游站点。
    it("no longer forces OpenRouter attribution headers", () => {
      expect(getProviderHeadersWithOverride("openrouter", undefined)).toBeUndefined()
      expect(
        getProviderHeadersWithOverride("openrouter", { "HTTP-Referer": "https://example.test" }),
      ).toEqual({ "HTTP-Referer": "https://example.test" })
    })

    // Regression: this header used to be a config-time default, so adding any header of your own
    // dropped it — and Anthropic then refuses the request outright.
    it("keeps Anthropic's browser-access header when the user adds their own", () => {
      expect(getProviderHeadersWithOverride("anthropic", { "X-Test": "1" })).toEqual({
        "X-Test": "1",
        "anthropic-dangerous-direct-browser-access": "true",
      })
    })
  })
})
