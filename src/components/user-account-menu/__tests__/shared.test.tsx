// src/components/user-account-menu/__tests__/shared.test.tsx
// @vitest-environment jsdom
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor, act } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/env", () => ({ env: { WXT_BILLING_API_URL: "https://billing.test" } }))
vi.mock("@/utils/message", () => ({
  sendMessage: vi.fn<(...args: any[]) => any>(),
}))
vi.mock("@/utils/billing/session", () => ({
  getBillingSession: vi.fn<(...args: any[]) => any>(),
  clearBillingSession: vi.fn<(...args: any[]) => any>().mockResolvedValue(undefined),
  onBillingSessionChanged: vi.fn<(...args: any[]) => any>().mockReturnValue(() => {}),
}))
vi.mock("@/utils/billing/rest", () => ({
  billingMe: vi.fn<(...args: any[]) => any>(),
  billingLogout: vi.fn<(...args: any[]) => any>().mockResolvedValue({ message: "ok" }),
}))

import { billingLogout, billingMe } from "@/utils/billing/rest"
import { clearBillingSession, getBillingSession } from "@/utils/billing/session"
import { sendMessage } from "@/utils/message"
import { ACCOUNT_STATE, useUserAccountMenu } from "../shared"

function withQueryClient({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("useUserAccountMenu (billing)", () => {
  it("reports guest when no session is stored", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    const { result } = renderHook(() => useUserAccountMenu(), { wrapper: withQueryClient })
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.state).toBe(ACCOUNT_STATE.GUEST)
  })

  it("reports authed with balance from /me", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "s1",
      email: "a@b.c",
      displayName: "喵",
      signedInAt: 1,
    })
    vi.mocked(billingMe).mockResolvedValue({
      user_id: "u1",
      email: "a@b.c",
      display_name: "喵",
      email_verified: true,
      balance: "2.5000",
      total_recharged: "3.0000",
      total_spent: "0.5000",
      total_tokens: 1,
      recent_calls: [],
    })
    const { result } = renderHook(() => useUserAccountMenu(), { wrapper: withQueryClient })
    await waitFor(() => expect(result.current.state).toBe(ACCOUNT_STATE.AUTHED))
    expect(result.current.email).toBe("a@b.c")
    await waitFor(() => expect(result.current.balanceYuan).toBe("2.5000"))
  })

  it("logout revokes server session and clears local storage", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "s1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    vi.mocked(billingMe).mockResolvedValue({
      user_id: "u1",
      email: "a@b.c",
      display_name: null,
      email_verified: true,
      balance: "0.0000",
      total_recharged: "0.0000",
      total_spent: "0.0000",
      total_tokens: 0,
      recent_calls: [],
    })
    const { result } = renderHook(() => useUserAccountMenu(), { wrapper: withQueryClient })
    await waitFor(() => expect(result.current.state).toBe(ACCOUNT_STATE.AUTHED))
    await act(async () => {
      result.current.logout.mutate()
    })
    await waitFor(() => {
      expect(billingLogout).toHaveBeenCalledWith("s1")
      expect(clearBillingSession).toHaveBeenCalled()
    })
  })

  it("opens the options account page", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    const { result } = renderHook(() => useUserAccountMenu(), { wrapper: withQueryClient })
    await waitFor(() => expect(result.current.isPending).toBe(false))
    act(() => result.current.openAccountSettings())
    expect(sendMessage).toHaveBeenCalledWith("openOptionsPage", { route: "/account" })
  })
})
