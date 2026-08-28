// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/env", () => ({ env: { WXT_BILLING_API_URL: "https://billing.test" } }))

vi.mock("@/utils/billing/session", () => ({
  getBillingSession: vi.fn<(...args: any[]) => any>(),
  setBillingSession: vi.fn<(...args: any[]) => any>(),
  clearBillingSession: vi.fn<(...args: any[]) => any>().mockResolvedValue(undefined),
  onBillingSessionChanged: vi.fn<(...args: any[]) => any>().mockReturnValue(() => {}),
}))
vi.mock("@/utils/billing/rest", () => ({
  billingLogin: vi.fn<(...args: any[]) => any>(),
  billingRegister: vi.fn<(...args: any[]) => any>(),
  billingVerifyCode: vi.fn<(...args: any[]) => any>(),
  billingResendVerify: vi.fn<(...args: any[]) => any>(),
  billingForgotPassword: vi.fn<(...args: any[]) => any>(),
  billingResetPassword: vi.fn<(...args: any[]) => any>(),
  billingLogout: vi.fn<(...args: any[]) => any>(),
  billingMe: vi.fn<(...args: any[]) => any>(),
}))

import { billingLogin, billingMe, billingRegister, billingVerifyCode } from "@/utils/billing/rest"
import { getBillingSession, setBillingSession } from "@/utils/billing/session"
import { AccountPage } from "../index"

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("AccountPage", () => {
  it("shows login and register entries when signed out", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    renderPage()
    await waitFor(() => {
      expect(screen.getByText("billing.login.title")).toBeTruthy()
    })
    expect(screen.getByText("billing.register.switchToLogin")).toBeTruthy()
  })

  it("logs in and stores the session", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    vi.mocked(billingLogin).mockResolvedValue({
      session_id: "sess-9",
      user_id: "u1",
      expires_in_days: 30,
    })
    renderPage()
    await waitFor(() => screen.getByLabelText("billing.login.email"))
    fireEvent.change(screen.getByLabelText("billing.login.email"), { target: { value: "a@b.c" } })
    fireEvent.change(screen.getByLabelText("billing.login.password"), {
      target: { value: "password1" },
    })
    fireEvent.click(screen.getByText("billing.login.submit"))
    await waitFor(() => {
      expect(setBillingSession).toHaveBeenCalledWith({
        sessionId: "sess-9",
        email: "a@b.c",
        displayName: null,
      })
    })
  })

  it("register → verify → auto-login flow", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    vi.mocked(billingRegister).mockResolvedValue({ message: "ok", user_id: "u1", mail_sent: true })
    vi.mocked(billingVerifyCode).mockResolvedValue({ message: "ok" })
    vi.mocked(billingLogin).mockResolvedValue({
      session_id: "sess-9",
      user_id: "u1",
      expires_in_days: 30,
    })
    renderPage()
    await waitFor(() => screen.getByText("billing.login.switchToRegister"))
    fireEvent.click(screen.getByText("billing.login.switchToRegister"))
    fireEvent.change(screen.getByLabelText("billing.register.displayName"), {
      target: { value: "喵" },
    })
    fireEvent.change(screen.getByLabelText("billing.register.email"), {
      target: { value: "a@b.c" },
    })
    fireEvent.change(screen.getByLabelText("billing.register.password"), {
      target: { value: "password1" },
    })
    fireEvent.click(screen.getByText("billing.register.submit"))
    await waitFor(() => screen.getByLabelText("billing.register.code"))
    fireEvent.change(screen.getByLabelText("billing.register.code"), {
      target: { value: "123456" },
    })
    fireEvent.click(screen.getByText("billing.register.verify"))
    await waitFor(() => {
      expect(billingVerifyCode).toHaveBeenCalledWith({ email: "a@b.c", code: "123456" })
      expect(billingLogin).toHaveBeenCalledWith({ email: "a@b.c", password: "password1" })
      expect(setBillingSession).toHaveBeenCalledWith({
        sessionId: "sess-9",
        email: "a@b.c",
        displayName: "喵",
      })
    })
  })

  it("shows back-to-login link in the verify view", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    vi.mocked(billingRegister).mockResolvedValue({ message: "ok", user_id: "u1", mail_sent: true })
    renderPage()
    await waitFor(() => screen.getByText("billing.login.switchToRegister"))
    fireEvent.click(screen.getByText("billing.login.switchToRegister"))
    fireEvent.change(screen.getByLabelText("billing.register.displayName"), {
      target: { value: "喵" },
    })
    fireEvent.change(screen.getByLabelText("billing.register.email"), {
      target: { value: "a@b.c" },
    })
    fireEvent.change(screen.getByLabelText("billing.register.password"), {
      target: { value: "password1" },
    })
    fireEvent.click(screen.getByText("billing.register.submit"))
    await waitFor(() => screen.getByLabelText("billing.register.code"))
    expect(screen.getByText("billing.reset.backToLogin")).toBeTruthy()
    fireEvent.click(screen.getByText("billing.reset.backToLogin"))
    await waitFor(() => {
      expect(screen.getByText("billing.login.title")).toBeTruthy()
    })
  })

  it("shows balance and logout when signed in", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: "喵",
      signedInAt: 1,
    })
    vi.mocked(billingMe).mockResolvedValue({
      user_id: "u1",
      email: "a@b.c",
      display_name: "喵",
      email_verified: true,
      balance: "3.1400",
      total_recharged: "5.0000",
      total_spent: "1.8600",
      total_tokens: 123,
      recent_calls: [],
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText("3.1400")).toBeTruthy()
    })
    expect(screen.getByText("a@b.c")).toBeTruthy()
  })
})
