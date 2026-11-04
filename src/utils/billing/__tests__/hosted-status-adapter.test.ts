import { describe, expect, it } from "vitest"
import { buildHostedAiStatusFromBilling } from "../hosted-status-adapter"

const FEATURES = [
  "pageTranslation",
  "customAction",
  "noteSuggestion",
  "selectionTranslation",
  "videoSubtitles",
  "inputTranslation",
  "languageDetection",
] as const

describe("buildHostedAiStatusFromBilling", () => {
  it("marks every feature and tier available when authenticated", () => {
    const status = buildHostedAiStatusFromBilling(true)
    expect(status.credits).toEqual([])
    for (const feature of FEATURES) {
      for (const tier of ["normal", "advance"] as const) {
        expect(status.features[feature][tier]).toEqual({
          accessAllowed: true,
          available: true,
          unavailableReason: null,
          requiresUltra: false,
          modelRevision: "billing-v1",
        })
      }
    }
  })

  it("marks everything authentication-required when signed out", () => {
    const status = buildHostedAiStatusFromBilling(false)
    const tier = status.features.pageTranslation.normal
    expect(tier.accessAllowed).toBe(false)
    expect(tier.available).toBe(false)
    expect(tier.unavailableReason).toBe("authentication_required")
    expect(tier.requiresUltra).toBe(false)
  })
})
