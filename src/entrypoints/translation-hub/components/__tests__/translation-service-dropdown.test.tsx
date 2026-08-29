// @vitest-environment jsdom

import type { ReactNode } from "react"
import type { HostedAiStatus, HostedAiTierStatus } from "@/utils/hosted-ai/types"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TranslationServiceDropdown } from "@/entrypoints/translation-hub/components/translation-service-dropdown"
import { buildHostedAiStatusFromBilling } from "@/utils/billing/hosted-status-adapter"
import { BUILT_IN_AI_PROVIDER_ID } from "@/utils/constants/provider-ids"
import { DEFAULT_PROVIDER_CONFIG_LIST } from "@/utils/constants/providers"

const {
  hostedAiStatusMock,
  providersConfigFixture,
  selectedIdsFixture,
  providersConfigAtom,
  selectedProviderIdsAtom,
  setSelectedIdsMock,
} = vi.hoisted(() => ({
  // Mutable holders so each test can reshape what the mocked hooks return.
  hostedAiStatusMock: { current: {} },
  providersConfigFixture: { current: [] as unknown[] },
  selectedIdsFixture: { current: [] as string[] },
  // Plain sentinel atoms — the mocked jotai hooks switch on identity.
  providersConfigAtom: {},
  selectedProviderIdsAtom: {},
  setSelectedIdsMock: vi.fn<(ids: string[]) => void>(),
}))

vi.mock("@/utils/atoms/config", () => ({
  configFieldsAtomMap: {
    providersConfig: providersConfigAtom,
  },
}))

vi.mock("@/entrypoints/translation-hub/atoms", () => ({
  selectedProviderIdsAtom,
}))

vi.mock("jotai", () => ({
  useAtom: (atom: object) => {
    if (atom === selectedProviderIdsAtom) return [selectedIdsFixture.current, setSelectedIdsMock]
    return [undefined, vi.fn<(value: unknown) => void>()]
  },
  useAtomValue: (atom: object) => {
    if (atom === providersConfigAtom) return providersConfigFixture.current
    return undefined
  },
}))

vi.mock("@/components/llm-providers/use-hosted-ai-status", () => ({
  useHostedAiStatus: () => hostedAiStatusMock.current,
}))

vi.mock("@/components/provider-icon", () => ({
  default: ({ name }: { name: string }) => <span>{`icon:${name}`}</span>,
}))

vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({ theme: "light" }),
}))

// Lightweight select stubs (same approach as prompt-selectors.test.tsx) so the
// group structure is assertable without a Base UI portal: items render their
// disabled state as data-disabled and skip selection when disabled.
vi.mock("@/components/ui/base-ui/select", async () => {
  const { createContext, useContext } = await import("react")
  const SelectContext = createContext<((value: string) => void) | null>(null)

  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children: ReactNode
      onValueChange: (value: string) => void
    }) => (
      <SelectContext.Provider value={onValueChange}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => (
      <button type="button" role="combobox">
        {children}
      </button>
    ),
    SelectValue: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectGroup: ({ children }: { children: ReactNode }) => (
      <div role="group">{children}</div>
    ),
    SelectLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({
      children,
      value,
      disabled,
    }: {
      children: ReactNode
      value: string
      disabled?: boolean
    }) => {
      const onValueChange = useContext(SelectContext)
      return (
        <div
          role="option"
          data-value={value}
          data-disabled={disabled ? "true" : undefined}
          aria-disabled={disabled ?? false}
          onClick={() => {
            if (!disabled) onValueChange?.(value)
          }}
        >
          {children}
        </div>
      )
    },
  }
})

const AVAILABLE_TIER: HostedAiTierStatus = {
  accessAllowed: true,
  available: true,
  unavailableReason: null,
  requiresUltra: false,
  modelRevision: "billing-v1",
}

/** A HostedAiStatus where every feature is available except selectionTranslation's tiers. */
function hostedStatus(selectionTranslation: {
  normal: HostedAiTierStatus
  advance: HostedAiTierStatus
}): HostedAiStatus {
  return {
    credits: [],
    features: {
      pageTranslation: { normal: AVAILABLE_TIER, advance: AVAILABLE_TIER },
      customAction: { normal: AVAILABLE_TIER, advance: AVAILABLE_TIER },
      noteSuggestion: { normal: AVAILABLE_TIER, advance: AVAILABLE_TIER },
      selectionTranslation,
      videoSubtitles: { normal: AVAILABLE_TIER, advance: AVAILABLE_TIER },
      inputTranslation: { normal: AVAILABLE_TIER, advance: AVAILABLE_TIER },
      languageDetection: { normal: AVAILABLE_TIER, advance: AVAILABLE_TIER },
    },
  }
}

function mockHostedAiStatus(status: HostedAiStatus, isSignedIn = true) {
  hostedAiStatusMock.current = { status, isSignedIn }
}

function mockHostedStatus(signedIn: boolean) {
  mockHostedAiStatus(buildHostedAiStatusFromBilling(signedIn), signedIn)
}

describe("TranslationServiceDropdown", () => {
  beforeEach(() => {
    setSelectedIdsMock.mockClear()
    providersConfigFixture.current = structuredClone(DEFAULT_PROVIDER_CONFIG_LIST)
    selectedIdsFixture.current = []
    mockHostedStatus(true)
  })

  it("renders a built-in AI group after the local groups with the advance tier hidden", () => {
    render(<TranslationServiceDropdown />)

    expect(screen.getByText("translateService.builtInModels")).toBeInTheDocument()
    const normal = screen.getByRole("option", {
      name: "icon:options.apiProviders.providers.name.builtInAi",
    })
    // The advance tier is hidden from pickers: billing serves one model at one
    // price, so a second built-in option would be a duplicate.
    expect(
      screen.queryByText("options.apiProviders.providers.name.builtInAiAdvance"),
    ).not.toBeInTheDocument()
    // The built-in group closes the list: the user's own providers stay first.
    const localItem = screen.getByRole("option", { name: "icon:OpenAI" })
    expect(localItem.compareDocumentPosition(normal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("keeps the local LLM and normal translator groups rendering", () => {
    render(<TranslationServiceDropdown />)

    expect(screen.getByText("translateService.llmModels")).toBeInTheDocument()
    expect(screen.getByText("translateService.normalTranslator")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "icon:OpenAI" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "icon:Microsoft Translator" })).toBeInTheDocument()
  })

  it("grays the built-in item out and shows login guidance when signed out", () => {
    mockHostedStatus(false)

    render(<TranslationServiceDropdown />)

    expect(
      screen.getByRole("option", {
        name: "icon:options.apiProviders.providers.name.builtInAi",
      }),
    ).toHaveAttribute("data-disabled", "true")
    expect(screen.getByText("hostedAi.availability.authenticationRequired")).toBeInTheDocument()
    expect(screen.queryByText("hostedAi.availability.ultraRequired")).not.toBeInTheDocument()

    // Local providers are unaffected by the hosted status.
    expect(screen.getByRole("option", { name: "icon:OpenAI" })).not.toHaveAttribute(
      "data-disabled",
    )
  })

  it("keeps built-in items selectable when signed in", () => {
    mockHostedStatus(true)

    render(<TranslationServiceDropdown />)

    expect(
      screen.getByRole("option", { name: "icon:options.apiProviders.providers.name.builtInAi" }),
    ).not.toHaveAttribute("data-disabled")
    expect(
      screen.queryByText("hostedAi.availability.authenticationRequired"),
    ).not.toBeInTheDocument()
  })

  it("shows no wall hint for a hidden Ultra-gated advance tier", () => {
    // Signed-in non-Ultra account: the visible normal tier stays runnable. The
    // advance tier reports ultra_required but is hidden from pickers, so no
    // option carries the wall and the hint must stay silent.
    mockHostedAiStatus(
      hostedStatus({
        normal: AVAILABLE_TIER,
        advance: {
          accessAllowed: false,
          available: false,
          unavailableReason: "ultra_required",
          requiresUltra: true,
          modelRevision: "billing-v1",
        },
      }),
    )

    render(<TranslationServiceDropdown />)

    expect(
      screen.getByRole("option", { name: "icon:options.apiProviders.providers.name.builtInAi" }),
    ).not.toHaveAttribute("data-disabled")
    expect(screen.queryByText("hostedAi.availability.ultraRequired")).not.toBeInTheDocument()
    expect(screen.queryByText("hostedAi.availability.authenticationRequired")).not.toBeInTheDocument()
  })

  it("prefers the sign-in wall when sign-in and Ultra walls coexist", () => {
    mockHostedAiStatus(
      hostedStatus({
        normal: {
          accessAllowed: false,
          available: false,
          unavailableReason: "authentication_required",
          requiresUltra: false,
          modelRevision: "billing-v1",
        },
        advance: {
          accessAllowed: false,
          available: false,
          unavailableReason: "ultra_required",
          requiresUltra: true,
          modelRevision: "billing-v1",
        },
      }),
    )

    render(<TranslationServiceDropdown />)

    expect(screen.getByText("hostedAi.availability.authenticationRequired")).toBeInTheDocument()
    expect(screen.queryByText("hostedAi.availability.ultraRequired")).not.toBeInTheDocument()
  })

  it("writes built-in selections through the existing selectedProviderIds setter", () => {
    render(<TranslationServiceDropdown />)

    fireEvent.click(
      screen.getByRole("option", { name: "icon:options.apiProviders.providers.name.builtInAi" }),
    )

    expect(setSelectedIdsMock).toHaveBeenCalledWith(BUILT_IN_AI_PROVIDER_ID)
  })

  it("does not write a selection when a grayed built-in item is clicked", () => {
    mockHostedStatus(false)

    render(<TranslationServiceDropdown />)

    fireEvent.click(
      screen.getByRole("option", { name: "icon:options.apiProviders.providers.name.builtInAi" }),
    )

    expect(setSelectedIdsMock).not.toHaveBeenCalled()
  })
})
