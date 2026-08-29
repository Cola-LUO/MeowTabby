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

import {
  billingForgotPassword,
  billingLogin,
  billingMe,
  billingRegister,
  billingResetPassword,
  billingVerifyCode,
} from "@/utils/billing/rest"
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
  it("shows only login form when signed out, register appears after clicking register link", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    renderPage()
    await waitFor(() => {
      expect(screen.getByText("billing.login.title")).toBeTruthy()
    })
    // 初始仅登录框：注册框的「display name」字段不应存在
    expect(screen.queryByLabelText("billing.register.displayName")).toBeNull()
    // 点击登录框内的「注册新账号」
    fireEvent.click(screen.getByText("billing.login.switchToRegister"))
    // 跳转后注册框出现
    expect(screen.getByLabelText("billing.register.displayName")).toBeTruthy()
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

  it("forgot password: email, code and new password fields are all visible on one page", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    renderPage()
    await waitFor(() => screen.getByText("billing.login.forgotPassword"))
    fireEvent.click(screen.getByText("billing.login.forgotPassword"))
    // 单页式：进入找回密码后，邮箱、验证码、新密码三个输入框应同时出现
    expect(screen.getByLabelText("billing.reset.email")).toBeTruthy()
    expect(screen.getByLabelText("billing.reset.code")).toBeTruthy()
    expect(screen.getByLabelText("billing.reset.newPassword")).toBeTruthy()
  })

  it("forgot password: carries login email, sends code, then resets password", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    vi.mocked(billingForgotPassword).mockResolvedValue({ message: "ok" })
    vi.mocked(billingResetPassword).mockResolvedValue({ message: "ok" })
    renderPage()
    await waitFor(() => screen.getByLabelText("billing.login.email"))
    fireEvent.change(screen.getByLabelText("billing.login.email"), { target: { value: "a@b.c" } })
    fireEvent.click(screen.getByText("billing.login.forgotPassword"))
    // 登录框已填的邮箱应自动带入找回密码表单
    expect(screen.getByDisplayValue("a@b.c")).toBeTruthy()
    // 发送验证码后按钮变为「重新发送」
    fireEvent.click(screen.getByText("billing.reset.sendCode"))
    await waitFor(() => {
      expect(billingForgotPassword).toHaveBeenCalledWith("a@b.c")
    })
    await waitFor(() => screen.getByText("billing.reset.resend"))
    // 填验证码 + 新密码提交
    fireEvent.change(screen.getByLabelText("billing.reset.code"), { target: { value: "123456" } })
    fireEvent.change(screen.getByLabelText("billing.reset.newPassword"), {
      target: { value: "newpass1" },
    })
    fireEvent.click(screen.getByText("billing.reset.submit"))
    await waitFor(() => {
      expect(billingResetPassword).toHaveBeenCalledWith({
        email: "a@b.c",
        code: "123456",
        newPassword: "newpass1",
      })
    })
    // 成功后回到登录页
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
    // 邮箱/余额上方应有「账户信息」标题（与页面顶部「账户登录」同级样式）
    expect(screen.getByText("billing.account.infoTitle")).toBeTruthy()
  })

  it("change password: sends code to login email, then resets and auto re-logs in", async () => {
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
    vi.mocked(billingForgotPassword).mockResolvedValue({ message: "ok" })
    vi.mocked(billingResetPassword).mockResolvedValue({ message: "ok" })
    vi.mocked(billingLogin).mockResolvedValue({
      session_id: "sess-2",
      user_id: "u1",
      expires_in_days: 7,
    })
    renderPage()
    await waitFor(() => screen.getByText("billing.account.infoTitle"))
    // 打开修改密码表单：验证码、新密码输入框同页可见
    fireEvent.click(screen.getByText("billing.account.changePassword"))
    expect(screen.getByLabelText("billing.changePassword.code")).toBeTruthy()
    expect(screen.getByLabelText("billing.changePassword.newPassword")).toBeTruthy()
    // 发送验证码（到登录邮箱），按钮变为「重新发送」
    fireEvent.click(screen.getByText("billing.reset.sendCode"))
    await waitFor(() => {
      expect(billingForgotPassword).toHaveBeenCalledWith("a@b.c")
    })
    await waitFor(() => screen.getByText("billing.reset.resend"))
    // 提交 → /reset-password → 吊销旧会话后自动用新密码重登 → 本地会话刷新
    fireEvent.change(screen.getByLabelText("billing.changePassword.code"), {
      target: { value: "123456" },
    })
    fireEvent.change(screen.getByLabelText("billing.changePassword.newPassword"), {
      target: { value: "newpass1" },
    })
    fireEvent.click(screen.getByText("billing.changePassword.submit"))
    await waitFor(() => {
      expect(billingResetPassword).toHaveBeenCalledWith({
        email: "a@b.c",
        code: "123456",
        newPassword: "newpass1",
      })
      expect(billingLogin).toHaveBeenCalledWith({ email: "a@b.c", password: "newpass1" })
      expect(setBillingSession).toHaveBeenCalledWith({
        sessionId: "sess-2",
        email: "a@b.c",
        displayName: "喵",
      })
    })
    // 成功后回到账户信息视图并提示已修改
    await waitFor(() => {
      expect(screen.getByText("billing.changePassword.success")).toBeTruthy()
    })
  })
})
