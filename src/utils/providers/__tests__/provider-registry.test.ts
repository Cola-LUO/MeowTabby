import type { ProvidersConfig } from "@/types/config/provider"
import { describe, expect, it } from "vitest"
import {
  BUILT_IN_AI_ADVANCE_PROVIDER_ID,
  BUILT_IN_AI_PROVIDER_ID,
} from "@/utils/constants/provider-ids"
import {
  getSelectableProvidersForCapability,
  getSystemProviderIdsForCapability,
  isSystemProviderId,
  resolveProviderRefForCapability,
} from "../provider-registry"

const PROVIDERS_CONFIG: ProvidersConfig = [
  {
    id: "google-translate-default",
    name: "Google Translate",
    enabled: true,
    provider: "google-translate",
  },
  {
    id: "microsoft-translate-disabled",
    name: "Microsoft Translate",
    enabled: false,
    provider: "microsoft-translate",
  },
]

describe("provider-registry translationHub capability", () => {
  it("enumerates both built-in AI providers for translationHub (validation still sees the hidden tier)", () => {
    expect(getSystemProviderIdsForCapability("translationHub")).toEqual([
      BUILT_IN_AI_PROVIDER_ID,
      BUILT_IN_AI_ADVANCE_PROVIDER_ID,
    ])
  })

  it("offers the system providers plus enabled local translate providers as selectable", () => {
    const options = getSelectableProvidersForCapability("translationHub", PROVIDERS_CONFIG)

    // The advance tier is hidden from every picker (billing backend serves a
    // single model at a single price, so the tiers are identical), while its
    // definition stays resolvable for existing selections.
    const systemOptions = options.filter((option) => "kind" in option && option.kind === "system")
    expect(systemOptions.map((option) => option.id)).toEqual([BUILT_IN_AI_PROVIDER_ID])

    const localIds = options
      .filter((option) => !("kind" in option && option.kind === "system"))
      .map((option) => option.id)
    expect(localIds).toEqual(["google-translate-default"])
  })

  it("resolves a system id to a system ref with the matching model tier", () => {
    expect(
      resolveProviderRefForCapability("translationHub", PROVIDERS_CONFIG, BUILT_IN_AI_PROVIDER_ID),
    ).toMatchObject({
      kind: "system",
      id: BUILT_IN_AI_PROVIDER_ID,
      modelTier: "normal",
    })
    expect(
      resolveProviderRefForCapability(
        "translationHub",
        PROVIDERS_CONFIG,
        BUILT_IN_AI_ADVANCE_PROVIDER_ID,
      ),
    ).toMatchObject({
      kind: "system",
      id: BUILT_IN_AI_ADVANCE_PROVIDER_ID,
      modelTier: "advance",
    })
  })

  it("resolves a local translate provider to a local ref for translationHub", () => {
    expect(
      resolveProviderRefForCapability(
        "translationHub",
        PROVIDERS_CONFIG,
        "google-translate-default",
      ),
    ).toMatchObject({
      kind: "local",
      id: "google-translate-default",
      config: { provider: "google-translate" },
    })
  })

  it("returns null for an id no translationHub provider has", () => {
    expect(resolveProviderRefForCapability("translationHub", PROVIDERS_CONFIG, "unknown-id")).toBe(
      null,
    )
  })

  it("marks the built-in AI ids as system provider ids", () => {
    expect(isSystemProviderId(BUILT_IN_AI_PROVIDER_ID)).toBe(true)
    expect(isSystemProviderId(BUILT_IN_AI_ADVANCE_PROVIDER_ID)).toBe(true)
  })
})

describe("provider-registry existing capabilities do not regress", () => {
  it("keeps the built-in AI providers on the pre-existing capabilities", () => {
    for (const capability of [
      "pageTranslation",
      "selectionTranslation",
      "videoSubtitles",
      "inputTranslation",
      "noteSuggestion",
      "customAction",
      "languageDetection",
    ] as const) {
      expect(getSystemProviderIdsForCapability(capability)).toEqual([
        BUILT_IN_AI_PROVIDER_ID,
        BUILT_IN_AI_ADVANCE_PROVIDER_ID,
      ])
    }
  })

  it("still offers enabled local translate providers for pageTranslation", () => {
    const options = getSelectableProvidersForCapability("pageTranslation", PROVIDERS_CONFIG)

    const localIds = options
      .filter((option) => !("kind" in option && option.kind === "system"))
      .map((option) => option.id)
    expect(localIds).toEqual(["google-translate-default"])
  })
})
