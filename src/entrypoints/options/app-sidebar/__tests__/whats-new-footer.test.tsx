// @vitest-environment jsdom
import type { ReactNode } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UPDATES_CACHE_KEY, UPDATES_PAGE_URL } from "@/utils/updates/feed"
import { WhatsNewFooter } from "../whats-new-footer"

vi.mock("@/utils/i18n", () => ({
  i18n: { t: (key: string) => key },
}))

vi.mock("i18next", () => ({
  default: { language: "zh-CN" },
}))

vi.mock("@/assets/icons/meowtabby.png?url", () => ({ default: "meow-logo.png" }))

vi.mock("@iconify/react", () => ({
  Icon: ({ className, icon }: { className?: string; icon: string }) => (
    <span
      aria-hidden="true"
      className={className}
      data-icon={icon}
      data-testid="whats-new-footer-icon"
    />
  ),
}))

vi.mock("@/components/ui/base-ui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/base-ui/popover", async () => {
  const React = await import("react")

  interface PopoverContextValue {
    open: boolean
    onOpenChange?: (open: boolean) => void
  }

  const PopoverContext = React.createContext<PopoverContextValue | null>(null)

  function usePopoverContext() {
    const context = React.use(PopoverContext)
    if (!context) {
      throw new Error("Popover components must be used within Popover.")
    }
    return context
  }

  function Popover({
    children,
    open = false,
    onOpenChange,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) {
    const contextValue = React.useMemo(() => ({ open, onOpenChange }), [open, onOpenChange])
    return <PopoverContext value={contextValue}>{children}</PopoverContext>
  }

  function PopoverTrigger({
    children,
    render: renderElement,
  }: {
    children: ReactNode
    render?: React.ReactElement<React.ComponentProps<"button">>
  }) {
    const { open, onOpenChange } = usePopoverContext()

    if (renderElement && React.isValidElement(renderElement)) {
      const originalOnClick = renderElement.props.onClick

      // eslint-disable-next-line react/no-clone-element
      return React.cloneElement(renderElement, {
        children,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          originalOnClick?.(event)
          onOpenChange?.(!open)
        },
      })
    }

    return (
      <button type="button" onClick={() => onOpenChange?.(!open)}>
        {children}
      </button>
    )
  }

  function PopoverContent({ children }: { children: ReactNode }) {
    const { open } = usePopoverContext()
    return open ? <div data-testid="whats-new-popover-content">{children}</div> : null
  }

  return {
    Popover,
    PopoverContent,
    PopoverTrigger,
  }
})

function renderWhatsNewFooter() {
  return render(<WhatsNewFooter />)
}

beforeEach(() => {
  localStorage.removeItem(UPDATES_CACHE_KEY)
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(UPDATES_CACHE_KEY)
})

describe("whatsNewFooter", () => {
  it("falls back to local copy and links to updates page when remote fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"))

    renderWhatsNewFooter()
    const trigger = screen.getByRole("button", { name: "options.whatsNew.trigger" })
    fireEvent.click(trigger)

    expect(screen.getByTestId("whats-new-popover-content")).toBeInTheDocument()
    const link = screen.getByRole("link")
    expect(link).toHaveAttribute("href", UPDATES_PAGE_URL)
    expect(screen.getByText("options.whatsNew.description")).toBeInTheDocument()
    expect(screen.getByAltText("MeowTabby")).toHaveAttribute("src", "meow-logo.png")
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument()
  })

  it("renders remote single item with image and link without carousel controls", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 1,
          pageUrl: UPDATES_PAGE_URL,
          items: [
            {
              id: "builtin-ai-pricing",
              title: { zh: "内置AI费用说明", en: "Built-in AI Pricing" },
              summary: { zh: "测试期间原价使用", en: "Official pricing" },
              image: "/meowtabby/updates/builtin-ai-pricing.svg",
              imageAlt: { zh: "费用横幅", en: "Pricing banner" },
              extensionBanner: { enabled: true, order: 1 },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    renderWhatsNewFooter()
    fireEvent.click(screen.getByRole("button", { name: "options.whatsNew.trigger" }))

    await waitFor(() => {
      expect(screen.getByText("测试期间原价使用")).toBeInTheDocument()
    })
    expect(screen.getByText("内置AI费用说明")).toBeInTheDocument()
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `${UPDATES_PAGE_URL}#builtin-ai-pricing`,
    )
    expect(screen.getByAltText("费用横幅")).toHaveAttribute(
      "src",
      "https://netxmeow.top/meowtabby/updates/builtin-ai-pricing.svg",
    )
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument()
  })

  it("supports carousel navigation when multiple remote items are enabled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 1,
          pageUrl: UPDATES_PAGE_URL,
          items: [
            {
              id: "item-1",
              title: { zh: "公告一", en: "Notice 1" },
              summary: { zh: "内容一", en: "Body 1" },
              image: "/meowtabby/updates/1.svg",
              extensionBanner: { enabled: true, order: 1 },
            },
            {
              id: "item-2",
              title: { zh: "公告二", en: "Notice 2" },
              summary: { zh: "内容二", en: "Body 2" },
              image: "/meowtabby/updates/2.svg",
              extensionBanner: { enabled: true, order: 2 },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    renderWhatsNewFooter()
    fireEvent.click(screen.getByRole("button", { name: "options.whatsNew.trigger" }))

    await waitFor(() => {
      expect(screen.getByText("内容一")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("内容二")).toBeInTheDocument()
    expect(screen.getByRole("link")).toHaveAttribute("href", `${UPDATES_PAGE_URL}#item-2`)
  })
})
