import type { ProvidersConfig } from "@/types/config/provider"
import { createStore } from "jotai"
import { describe, expect, it, vi } from "vitest"
import {
  BUILT_IN_AI_ADVANCE_PROVIDER_ID,
  BUILT_IN_AI_PROVIDER_ID,
} from "@/utils/constants/provider-ids"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { selectedProviderIdsAtom } from "../atoms"

// The hub atoms only read `providersConfig` out of the config atom map, so the
// mock swaps in a plain writable jotai atom the test can seed per case. All
// other helpers (filterEnabledProvidersConfig, getTranslateProvidersConfig)
// run for real so the default-selection logic is exercised end to end.
vi.mock("@/utils/atoms/config", async () => {
  const { atom } = await import("jotai")
  return {
    configFieldsAtomMap: {
      providersConfig: atom<ProvidersConfig | undefined>(undefined),
    },
  }
})

const LOCAL_ENABLED = {
  id: "google-translate-default",
  name: "Google Translate",
  enabled: true,
  provider: "google-translate",
} as const

const LOCAL_DISABLED = {
  id: "microsoft-translate-disabled",
  name: "Microsoft Translate",
  enabled: false,
  provider: "microsoft-translate",
} as const

describe("selectedProviderIdsAtom", () => {
  it("defaults to enabled local translate providers plus both built-in AI ids", () => {
    const store = createStore()
    void store.set(configFieldsAtomMap.providersConfig, [LOCAL_ENABLED, LOCAL_DISABLED])

    expect(store.get(selectedProviderIdsAtom)).toEqual([
      LOCAL_ENABLED.id,
      BUILT_IN_AI_PROVIDER_ID,
      BUILT_IN_AI_ADVANCE_PROVIDER_ID,
    ])
  })

  it("dedupes when a local row somehow carries a built-in AI id", () => {
    const store = createStore()
    void store.set(configFieldsAtomMap.providersConfig, [
      { ...LOCAL_ENABLED, id: BUILT_IN_AI_PROVIDER_ID },
    ])

    const ids = store.get(selectedProviderIdsAtom)
    expect(ids).toEqual([BUILT_IN_AI_PROVIDER_ID, BUILT_IN_AI_ADVANCE_PROVIDER_ID])
  })

  it("still honors an explicit override over the default", () => {
    const store = createStore()
    void store.set(configFieldsAtomMap.providersConfig, [LOCAL_ENABLED])

    store.set(selectedProviderIdsAtom, [LOCAL_ENABLED.id])

    expect(store.get(selectedProviderIdsAtom)).toEqual([LOCAL_ENABLED.id])
  })
})
