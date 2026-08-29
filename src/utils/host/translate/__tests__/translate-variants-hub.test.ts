// @vitest-environment jsdom

import type { BillingHostedStatus } from "@/utils/billing/types"
import type { SystemProviderRef } from "@/utils/providers/provider-registry"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { BUILT_IN_AI_PROVIDER_ID } from "@/utils/constants/provider-ids"
import { translateTextForHub } from "@/utils/host/translate/translate-variants"

// The hub variant shares the input-translation pipeline, so it gets the same
// mock set as translate-text.test.tsx: storage config in, background messages
// out, prompt builder and detection stubbed.
vi.mock("@/utils/config/storage", () => ({
  getLocalConfig: vi.fn<(...args: any[]) => any>(),
}))

vi.mock("@/utils/message", () => ({
  sendMessage: vi.fn<(...args: any[]) => any>(),
}))

vi.mock("@/utils/prompts/translate", () => ({
  getTranslatePrompt: vi.fn<(...args: any[]) => any>(),
}))

vi.mock("@/utils/content/language", () => ({
  detectLanguage: vi.fn<(...args: any[]) => any>(),
}))

vi.mock("@/utils/host/translate/webpage-context", () => ({
  getOrCreateWebPageContext: vi.fn<(...args: any[]) => any>(),
}))

vi.mock("@/utils/host/translate/webpage-summary", () => ({
  getOrGenerateWebPageSummary: vi.fn<(...args: any[]) => any>(),
}))

const mockGetLocalConfig = vi.mocked((await import("@/utils/config/storage")).getLocalConfig)
const mockSendMessage = vi.mocked((await import("@/utils/message")).sendMessage)
const mockGetTranslatePrompt = vi.mocked(
  (await import("@/utils/prompts/translate")).getTranslatePrompt,
)
const mockGetOrCreateWebPageContext = vi.mocked(
  (await import("@/utils/host/translate/webpage-context")).getOrCreateWebPageContext,
)
const mockGetOrGenerateWebPageSummary = vi.mocked(
  (await import("@/utils/host/translate/webpage-summary")).getOrGenerateWebPageSummary,
)

const SYSTEM_REF: SystemProviderRef = {
  kind: "system",
  id: BUILT_IN_AI_PROVIDER_ID,
  name: "Built-in AI",
  modelTier: "normal",
}

const SIGNED_IN: BillingHostedStatus = {
  authenticated: true,
  balanceYuan: "1.0000",
  email: "a@b.c",
}

function enqueueReturns(text: string) {
  mockSendMessage.mockImplementation(async (type: string) => {
    if (type === "getHostedAiStatus") {
      return SIGNED_IN
    }
    if (type === "enqueueTranslateRequest") {
      return text
    }
    return undefined
  })
}

function enqueueCalls() {
  return mockSendMessage.mock.calls.filter(([type]: [string]) => type === "enqueueTranslateRequest")
}

describe("translateTextForHub", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLocalConfig.mockResolvedValue(DEFAULT_CONFIG)
    mockGetTranslatePrompt.mockResolvedValue({
      systemPrompt: "system prompt",
      prompt: "user prompt",
    })
  })

  it("dispatches a system ref through enqueueTranslateRequest on the selectionTranslation route", async () => {
    enqueueReturns("hub translation")

    const result = await translateTextForHub("hello hub", "eng", "cmn", SYSTEM_REF)

    expect(result).toBe("hub translation")
    expect(mockSendMessage).toHaveBeenCalledWith(
      "enqueueTranslateRequest",
      expect.objectContaining({
        text: "hello hub",
        langConfig: {
          sourceCode: "eng",
          targetCode: "cmn",
          level: DEFAULT_CONFIG.language.level,
        },
        // The system ref arrives serialized: tier kept for billing, revision
        // for the cache key.
        providerRef: {
          kind: "system",
          providerId: BUILT_IN_AI_PROVIDER_ID,
          modelTier: "normal",
          modelRevision: "billing-v1",
        },
        hostedFeature: "selectionTranslation",
        textFormat: "plain",
      }),
    )
  })

  it("attaches no webpage context — the hub is an extension page", async () => {
    enqueueReturns("hub translation")

    await translateTextForHub("hello hub", "eng", "cmn", SYSTEM_REF)

    expect(mockGetOrCreateWebPageContext).not.toHaveBeenCalled()
    expect(mockGetOrGenerateWebPageSummary).not.toHaveBeenCalled()
    expect(mockSendMessage).toHaveBeenCalledWith(
      "enqueueTranslateRequest",
      expect.objectContaining({
        webTitle: undefined,
        webDescription: undefined,
        webContent: undefined,
        webSummary: undefined,
      }),
    )
  })

  it("passes a local provider ref straight through without a hosted status round trip", async () => {
    enqueueReturns("local translation")
    const localConfig = {
      id: "google-translate-default",
      name: "Google Translate",
      enabled: true,
      provider: "google-translate",
    } as const

    const result = await translateTextForHub("hello hub", "eng", "cmn", localConfig)

    expect(result).toBe("local translation")
    expect(mockSendMessage).not.toHaveBeenCalledWith("getHostedAiStatus")
    expect(mockSendMessage).toHaveBeenCalledWith(
      "enqueueTranslateRequest",
      expect.objectContaining({
        providerRef: { kind: "local", config: localConfig },
        hostedFeature: "selectionTranslation",
      }),
    )
  })

  it("skips the request when source and target languages match", async () => {
    enqueueReturns("hub translation")

    const result = await translateTextForHub("hello hub", "eng", "eng", SYSTEM_REF)

    expect(result).toBe("")
    expect(enqueueCalls()).toHaveLength(0)
  })

  it("forwards an auto source code unresolved for the background to detect", async () => {
    enqueueReturns("hub translation")

    await translateTextForHub("hello hub", "auto", "cmn", SYSTEM_REF)

    expect(mockSendMessage).toHaveBeenCalledWith(
      "enqueueTranslateRequest",
      expect.objectContaining({
        langConfig: {
          sourceCode: "auto",
          targetCode: "cmn",
          level: DEFAULT_CONFIG.language.level,
        },
      }),
    )
  })

  it("throws when no global config is stored", async () => {
    mockGetLocalConfig.mockResolvedValue(null)

    await expect(translateTextForHub("hello hub", "eng", "cmn", SYSTEM_REF)).rejects.toThrow(
      "No global config when translate text",
    )
    expect(enqueueCalls()).toHaveLength(0)
  })
})
