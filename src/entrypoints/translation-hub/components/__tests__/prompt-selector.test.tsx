// @vitest-environment jsdom

import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PromptSelector } from "@/entrypoints/translation-hub/components/prompt-selector"
import { BUILT_IN_AI_PROVIDER_ID } from "@/utils/constants/provider-ids"

const {
  pageTranslationAtom,
  selectedProviderIdsAtom,
  selectedProvidersAtom,
  selectedProviderIdsFixture,
  selectedProvidersFixture,
} = vi.hoisted(() => ({
  pageTranslationAtom: {},
  selectedProviderIdsAtom: {},
  selectedProvidersAtom: {},
  selectedProviderIdsFixture: { current: [] as string[] },
  selectedProvidersFixture: { current: [] as unknown[] },
}))

vi.mock("@/entrypoints/translation-hub/atoms", () => ({
  selectedProvidersAtom,
  selectedProviderIdsAtom,
}))

vi.mock("@/utils/atoms/config", () => ({
  configFieldsAtomMap: {
    pageTranslation: pageTranslationAtom,
  },
}))

vi.mock("jotai", () => ({
  useAtom: (atom: object) => {
    if (atom === pageTranslationAtom) {
      return [
        { customPromptsConfig: { patterns: [], promptId: null } },
        vi.fn<(value: unknown) => void>(),
      ]
    }
    return [undefined, vi.fn()]
  },
  useAtomValue: (atom: object) => {
    if (atom === selectedProvidersAtom) return selectedProvidersFixture.current
    if (atom === selectedProviderIdsAtom) return selectedProviderIdsFixture.current
    return undefined
  },
}))

// Lightweight select stubs: the selector's visibility is what is under test,
// not Base UI behavior.
vi.mock("@/components/ui/base-ui/select", async () => {
  const { createElement } = await import("react")
  return {
    Select: ({ children }: { children: ReactNode }) => createElement("div", null, children),
    SelectTrigger: ({ children }: { children: ReactNode }) =>
      createElement("button", { role: "combobox", type: "button" }, children),
    SelectValue: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
    SelectContent: ({ children }: { children: ReactNode }) => createElement("div", null, children),
    SelectGroup: ({ children }: { children: ReactNode }) => createElement("div", null, children),
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) =>
      createElement("div", { role: "option", "data-value": value }, children),
  }
})

describe("PromptSelector", () => {
  beforeEach(() => {
    selectedProvidersFixture.current = []
    selectedProviderIdsFixture.current = []
  })

  it("shows for a selected built-in AI provider even without local LLM rows", () => {
    // Built-in AI ids resolve to no local config row, so selectedProviders is
    // empty — the selector must look at the selected ids themselves.
    selectedProviderIdsFixture.current = [BUILT_IN_AI_PROVIDER_ID]

    render(<PromptSelector />)

    expect(screen.getByRole("combobox")).toBeInTheDocument()
  })

  it("stays hidden when only a local non-LLM provider is selected", () => {
    selectedProviderIdsFixture.current = ["google-translate-default"]

    const { container } = render(<PromptSelector />)

    expect(container).toBeEmptyDOMElement()
  })

  it("still shows for a local LLM provider", () => {
    selectedProvidersFixture.current = [{ id: "provider-1", name: "OpenAI", provider: "openai" }]
    selectedProviderIdsFixture.current = ["provider-1"]

    render(<PromptSelector />)

    expect(screen.getByRole("combobox")).toBeInTheDocument()
  })
})
