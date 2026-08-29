// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TranslationCard } from "@/entrypoints/translation-hub/components/translation-card"
import { BUILT_IN_AI_PROVIDER_ID } from "@/utils/constants/provider-ids"

const {
  anchoredToastAddMock,
  clipboardWriteMock,
  capturedMutationFn,
  executeTranslateMock,
  getProviderConfigByIdMock,
  getTranslatePromptSentinel,
  languageAtom,
  providersAtom,
  providersFixture,
  requestAtom,
  requestFixture,
  selectedProviderIdsAtom,
  translateTextForHubMock,
} = vi.hoisted(() => ({
  anchoredToastAddMock: vi.fn<(options: unknown) => void>(),
  clipboardWriteMock: vi.fn<(text: string) => void>(),
  // Captured from the mocked useMutation so tests can drive the real
  // mutationFn without involving react-query state management.
  capturedMutationFn: {
    current: undefined as undefined | ((request: unknown) => Promise<unknown>),
  },
  executeTranslateMock: vi.fn<(...args: unknown[]) => Promise<string>>(),
  getProviderConfigByIdMock: vi.fn<(...args: unknown[]) => unknown>(),
  getTranslatePromptSentinel: Symbol("getTranslatePrompt"),
  languageAtom: {},
  providersAtom: {},
  providersFixture: { current: [] as unknown[] },
  requestAtom: {},
  requestFixture: { current: null },
  selectedProviderIdsAtom: {},
  translateTextForHubMock: vi.fn<(...args: unknown[]) => Promise<string>>(),
}))

interface UseMutationMockShape {
  data: string | undefined
  isError: boolean
  isPending: boolean
  mutate: (request: unknown) => void
  error: Error | undefined
}

const useMutationMock = vi.hoisted(() => {
  const initial: UseMutationMockShape = {
    data: "Translated text",
    isError: false,
    isPending: false,
    mutate: vi.fn<(request: unknown) => void>(),
    error: undefined,
  }
  return { current: initial }
})

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: { mutationFn: (request: unknown) => Promise<unknown> }) => {
    capturedMutationFn.current = options.mutationFn
    return useMutationMock.current
  },
}))

vi.mock("jotai", () => ({
  useAtom: () => [["provider-1"], vi.fn<(value: unknown) => void>()],
  useAtomValue: (atom: object) => {
    if (atom === requestAtom) return requestFixture.current
    if (atom === languageAtom) return { level: "intermediate" }
    if (atom === providersAtom) return providersFixture.current
    return undefined
  },
  useSetAtom: () => vi.fn<(value: unknown) => void>(),
}))

vi.mock("@/components/provider-icon", () => ({
  default: () => <span>Provider icon</span>,
}))

vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({ theme: "light" }),
}))

vi.mock("@/components/ui/base-ui/toast", () => ({
  anchoredToastManager: { add: anchoredToastAddMock },
}))

vi.mock("@/utils/atoms/config", () => ({
  configFieldsAtomMap: {
    language: languageAtom,
    providersConfig: providersAtom,
  },
}))

vi.mock("@/utils/config/helpers", () => ({
  getProviderConfigById: getProviderConfigByIdMock,
}))

vi.mock("@/utils/i18n", () => ({
  i18n: { t: (key: string) => key },
}))

vi.mock("@/entrypoints/translation-hub/atoms", () => ({
  selectedProviderIdsAtom,
  translateRequestAtom: requestAtom,
  translationCardExpandedStateAtom: {},
}))

vi.mock("@/utils/analytics", () => ({
  trackFeatureAttempt: (_context: unknown, run: () => Promise<unknown>) => run(),
  createFeatureUsageContext: vi.fn<(...args: unknown[]) => object>(() => ({})),
}))

vi.mock("@/utils/host/translate/execute-translate", () => ({
  executeTranslate: executeTranslateMock,
}))

vi.mock("@/utils/host/translate/translate-variants", () => ({
  translateTextForHub: translateTextForHubMock,
}))

vi.mock("@/utils/prompts/translate", () => ({
  getTranslatePrompt: getTranslatePromptSentinel,
}))

const LOCAL_PROVIDER = { id: "provider-1", name: "OpenAI", provider: "openai" }

const HUB_REQUEST = {
  inputText: "hello",
  sourceLanguage: "eng",
  targetLanguage: "cmn",
  timestamp: 1,
}

describe("TranslationCard copy feedback", () => {
  beforeEach(() => {
    anchoredToastAddMock.mockReset()
    clipboardWriteMock.mockReset()
    getProviderConfigByIdMock.mockReturnValue(LOCAL_PROVIDER)
    providersFixture.current = []
    requestFixture.current = null
    executeTranslateMock.mockReset()
    translateTextForHubMock.mockReset()
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteMock },
    })
    useMutationMock.current = {
      data: "Translated text",
      isError: false,
      isPending: false,
      mutate: vi.fn<(request: unknown) => void>(),
      error: undefined,
    }
  })

  it("anchors provider-specific copy feedback to the copy button", () => {
    render(
      <TranslationCard
        providerId="provider-1"
        isExpanded
        onExpandedChange={vi.fn<(expanded: boolean) => void>()}
      />,
    )

    const copyButton = screen.getByTitle("translationHub.copyTranslation")
    fireEvent.click(copyButton)

    expect(clipboardWriteMock).toHaveBeenCalledWith("Translated text")
    expect(anchoredToastAddMock).toHaveBeenCalledWith({
      data: { tooltipStyle: true },
      id: "translation-copy-provider-1",
      positionerProps: { anchor: copyButton, sideOffset: 6 },
      title: "translationHub.copiedToClipboard",
    })
  })
})

describe("TranslationCard error display", () => {
  beforeEach(() => {
    getProviderConfigByIdMock.mockReturnValue(LOCAL_PROVIDER)
    providersFixture.current = []
    requestFixture.current = null
    useMutationMock.current = {
      data: undefined,
      isError: true,
      isPending: false,
      mutate: vi.fn<(request: unknown) => void>(),
      error: new Error(
        "upstream_429_rate_limit_exceeded_for_provider_openai_completions_with_a_very_long_unbroken_token_stream_that_overflows_the_card_boundary",
      ),
    }
  })

  it("renders long unbroken error messages with overflow-wrap so they stay inside the card", () => {
    render(
      <TranslationCard
        providerId="provider-1"
        isExpanded
        onExpandedChange={vi.fn<(expanded: boolean) => void>()}
      />,
    )

    const errorParagraph = screen.getByText(
      "upstream_429_rate_limit_exceeded_for_provider_openai_completions_with_a_very_long_unbroken_token_stream_that_overflows_the_card_boundary",
    )
    // break-words forces long unbreakable runs to wrap instead of overflowing
    expect(errorParagraph.className).toContain("break-words")
    // whitespace-pre-wrap preserves newlines in multi-line provider errors
    expect(errorParagraph.className).toContain("whitespace-pre-wrap")
  })
})

describe("TranslationCard provider routing", () => {
  beforeEach(() => {
    anchoredToastAddMock.mockReset()
    clipboardWriteMock.mockReset()
    providersFixture.current = []
    requestFixture.current = null
    executeTranslateMock.mockReset()
    executeTranslateMock.mockResolvedValue("local output")
    translateTextForHubMock.mockReset()
    translateTextForHubMock.mockResolvedValue("hub output")
    getProviderConfigByIdMock.mockReturnValue(undefined)
    useMutationMock.current = {
      data: undefined,
      isError: false,
      isPending: false,
      mutate: vi.fn<(request: unknown) => void>(),
      error: undefined,
    }
  })

  async function renderAndRunMutation(providerId: string) {
    render(
      <TranslationCard
        providerId={providerId}
        isExpanded
        onExpandedChange={vi.fn<(expanded: boolean) => void>()}
      />,
    )
    expect(capturedMutationFn.current).toBeTypeOf("function")
    return await capturedMutationFn.current?.(HUB_REQUEST)
  }

  it("routes a built-in AI id to translateTextForHub with the resolved system ref", async () => {
    const result = await renderAndRunMutation(BUILT_IN_AI_PROVIDER_ID)

    expect(result).toBe("hub output")
    expect(translateTextForHubMock).toHaveBeenCalledTimes(1)
    expect(translateTextForHubMock).toHaveBeenCalledWith(
      "hello",
      "eng",
      "cmn",
      expect.objectContaining({
        kind: "system",
        id: BUILT_IN_AI_PROVIDER_ID,
        modelTier: "normal",
      }),
    )
    expect(executeTranslateMock).not.toHaveBeenCalled()
  })

  it("still routes a local id through executeTranslate with the translate prompt", async () => {
    getProviderConfigByIdMock.mockReturnValue(LOCAL_PROVIDER)

    const result = await renderAndRunMutation("provider-1")

    expect(result).toBe("local output")
    expect(executeTranslateMock).toHaveBeenCalledTimes(1)
    expect(executeTranslateMock).toHaveBeenCalledWith(
      "hello",
      { sourceCode: "eng", targetCode: "cmn", level: "intermediate" },
      LOCAL_PROVIDER,
      getTranslatePromptSentinel,
    )
    expect(translateTextForHubMock).not.toHaveBeenCalled()
  })

  it("resolves a built-in AI id even though no local config row exists for it", async () => {
    // getProviderConfigById returns undefined (the beforeEach default): the old
    // code path threw "Provider not found" before any translation could run.
    const result = await renderAndRunMutation(BUILT_IN_AI_PROVIDER_ID)

    expect(getProviderConfigByIdMock).toHaveBeenCalled()
    expect(result).toBe("hub output")
    expect(translateTextForHubMock).toHaveBeenCalled()
  })

  it("renders the built-in card instead of dropping it when no local config exists", () => {
    render(
      <TranslationCard
        providerId={BUILT_IN_AI_PROVIDER_ID}
        isExpanded
        onExpandedChange={vi.fn<(expanded: boolean) => void>()}
      />,
    )

    // The old `if (!provider) return null` guard dropped system cards entirely.
    expect(screen.getByTitle("translationHub.deleteCard")).toBeInTheDocument()
  })
})
