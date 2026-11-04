// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ModelSelectionPage } from ".."

// The three sections reach into config storage and provider hooks; the page test only cares that
// they are mounted, in order, under the page heading.
vi.mock("../feature-providers", () => ({
  FeatureProvidersConfig: () => <div data-testid="feature-providers" />,
}))
vi.mock("../language-detection", () => ({
  LanguageDetectionConfig: () => <div data-testid="language-detection" />,
}))
vi.mock("../ai-content-aware", () => ({
  AIContentAwareConfig: () => <div data-testid="ai-content-aware" />,
}))

describe("ModelSelectionPage", () => {
  it("mounts the three model-selection sections in order", () => {
    render(<ModelSelectionPage />)

    const sections = screen.getAllByTestId(/feature-providers|language-detection|ai-content-aware/)
    expect(sections.map((node) => node.getAttribute("data-testid"))).toEqual([
      "feature-providers",
      "language-detection",
      "ai-content-aware",
    ])
  })

  it("renders the page title and description", () => {
    render(<ModelSelectionPage />)

    expect(screen.getByText("options.modelSelection.title")).toBeTruthy()
    expect(screen.getByText("options.modelSelection.pageDescription")).toBeTruthy()
  })
})
