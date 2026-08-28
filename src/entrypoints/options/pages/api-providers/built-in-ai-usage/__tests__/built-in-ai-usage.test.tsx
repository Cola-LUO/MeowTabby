// @vitest-environment jsdom
import type { HostedAiStatusResult } from "@/components/llm-providers/use-hosted-ai-status"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BuiltInAiUsageConfig } from "@/entrypoints/options/pages/api-providers/built-in-ai-usage"

const { hostedAiState } = vi.hoisted(() => {
  const state: { value: HostedAiStatusResult } = {
    value: {
      status: undefined,
      balanceYuan: undefined,
      isSignedIn: true,
      isPending: true,
      isError: false,
    },
  }
  return { hostedAiState: state }
})

vi.mock("@/components/llm-providers/use-hosted-ai-status", () => ({
  useHostedAiStatus: () => hostedAiState.value,
}))

vi.mock("@/utils/message", () => ({
  sendMessage: vi.fn<(...args: any[]) => any>(),
}))

vi.mock("@/utils/i18n", () => ({
  i18n: {
    t: (key: string, values?: Array<string | number>) =>
      values?.length ? `${key}:${values.join(",")}` : key,
  },
}))

import { sendMessage } from "@/utils/message"

describe("BuiltInAiUsageConfig", () => {
  beforeEach(() => {
    hostedAiState.value = {
      status: undefined,
      balanceYuan: undefined,
      isSignedIn: true,
      isPending: true,
      isError: false,
    }
    vi.clearAllMocks()
  })

  it("shows the billing balance next to the recharge entry", () => {
    hostedAiState.value = {
      status: undefined,
      balanceYuan: "12.3400",
      isSignedIn: true,
      isPending: false,
      isError: false,
    }

    render(<BuiltInAiUsageConfig />)

    expect(screen.getByText("billing.account.balance")).toBeInTheDocument()
    expect(screen.getByText("¥12.3400")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "billing.account.recharge" }))
    expect(vi.mocked(sendMessage).mock.calls[0]!).toEqual([
      "openOptionsPage",
      { route: "/account" },
    ])
  })

  it("holds a placeholder while the balance is unknown (e.g. /me failed)", () => {
    hostedAiState.value = {
      status: undefined,
      balanceYuan: undefined,
      isSignedIn: true,
      isPending: false,
      isError: true,
    }

    render(<BuiltInAiUsageConfig />)

    expect(screen.getByText("¥…")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "billing.account.recharge" })).toBeInTheDocument()
  })

  it("shows a skeleton while the status is loading", () => {
    render(<BuiltInAiUsageConfig />)

    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("renders nothing at all for guests", () => {
    hostedAiState.value = {
      status: undefined,
      balanceYuan: undefined,
      isSignedIn: false,
      isPending: false,
      isError: false,
    }

    const { container } = render(<BuiltInAiUsageConfig />)

    expect(container).toBeEmptyDOMElement()
  })
})
