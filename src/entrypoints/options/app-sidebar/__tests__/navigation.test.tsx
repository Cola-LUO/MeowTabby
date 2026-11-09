// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { SidebarProvider } from "@/components/ui/base-ui/sidebar"
import { FeaturesNav } from "../features-nav"
import { SettingsNav } from "../settings-nav"

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

function renderNavigation(path = "/account") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <SettingsNav />
        <FeaturesNav />
      </SidebarProvider>
    </MemoryRouter>,
  )
}

describe("设置导航分类", () => {
  it("按新顺序显示设置和功能，PDF 翻译带 New 标记", () => {
    renderNavigation()
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/account",
      "/api-providers",
      "/model-selection",
      "/preference",
      "/pdf-translate",
      "/tts",
      expect.stringContaining("translation-hub"),
    ])
    expect(
      within(screen.getByRole("link", { name: /options.tools.pdfTranslate/ })).getByText("New"),
    ).toBeVisible()
  })

  it("功能设置默认折叠，展开后按顺序访问各页面和悬浮工具子项", () => {
    renderNavigation("/input-translation")
    const trigger = screen.getByRole("button", { name: "options.sidebar.featureSettings" })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("link", { name: "options.shortcuts.title" })).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"))
    expect(links.slice(4, 9)).toEqual([
      "/shortcuts",
      "/page-translation",
      "/input-translation",
      "/video-subtitles",
      "/custom-actions",
    ])
    fireEvent.click(screen.getByRole("button", { name: "options.overlayTools.title" }))
    for (const path of ["/floating-button", "/selection-toolbar", "/context-menu"]) {
      expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === path)).toBe(
        true,
      )
    }
  })
})
