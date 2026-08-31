// @vitest-environment jsdom
import type { ReactNode } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WhatsNewFooter } from "../whats-new-footer"

vi.mock("#imports", () => ({
  i18n: { t: (key: string) => key },
}))

vi.mock("@/assets/icons/read-frog.png?url", () => ({ default: "meow-logo.png" }))

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

afterEach(() => {
  vi.clearAllMocks()
})

describe("whatsNewFooter", () => {
  it("renders the sidebar button with the what's-new title", () => {
    renderWhatsNewFooter()
    expect(screen.getByRole("button", { name: "options.whatsNew.title" })).toBeInTheDocument()
  })

  it("shows the brand block and fee notice when opened", () => {
    renderWhatsNewFooter()

    const trigger = screen.getByRole("button", { name: "options.whatsNew.title" })
    fireEvent.click(trigger)

    expect(screen.getByTestId("whats-new-popover-content")).toBeInTheDocument()
    expect(screen.getByText("MeowTabby")).toBeInTheDocument()
    expect(screen.getByText("options.whatsNew.description")).toBeInTheDocument()
    expect(screen.getByAltText("MeowTabby")).toHaveAttribute("src", "meow-logo.png")
  })
})
