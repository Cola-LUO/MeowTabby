// src/utils/billing/__tests__/rest.test.ts
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"
import { getRequestErrorMeta } from "@/utils/request/retry-policy"

vi.mock("@/utils/billing/session", () => ({
  clearBillingSession: vi.fn<(...args: any[]) => any>().mockResolvedValue(undefined),
}))

vi.mock("@/env", () => ({
  env: { WXT_BILLING_API_URL: "https://billing.test" },
}))

import { clearBillingSession } from "@/utils/billing/session"
import {
  BillingApiError,
  billingCancel,
  billingLogin,
  billingMe,
  billingRegister,
  billingResetPassword,
  classifyBillingHttpError,
} from "../rest"

const fetchMock = vi.fn<(...args: any[]) => any>()

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: vi.fn<(...args: any[]) => any>().mockResolvedValue(body),
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.mocked(clearBillingSession).mockClear()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("request shapes", () => {
  it("registers with display_name and posts JSON", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { message: "ok", user_id: "u1", mail_sent: true }),
    )
    await billingRegister({ email: "a@b.c", password: "password1", displayName: "妮称" })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://billing.test/register")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      email: "a@b.c",
      password: "password1",
      display_name: "妮称",
    })
  })

  it("attaches Bearer session on /me GET", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        user_id: "u1",
        email: "a@b.c",
        display_name: null,
        email_verified: true,
        balance: "1.0000",
        total_recharged: "1.0000",
        total_spent: "0.0000",
        total_tokens: 0,
        recent_calls: [],
      }),
    )
    await billingMe("sess-1")
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://billing.test/me")
    expect(init.method).toBe("GET")
    expect(init.headers.Authorization).toBe("Bearer sess-1")
  })

  it("sends request_id to /v1/cancel", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { message: "ok" }))
    await billingCancel("sess-1", "rid-1")
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://billing.test/v1/cancel")
    expect(init.headers.Authorization).toBe("Bearer sess-1")
    expect(JSON.parse(init.body)).toEqual({ request_id: "rid-1" })
  })

  it("maps reset-password field names", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { message: "ok" }))
    await billingResetPassword({ email: "a@b.c", code: "123456", newPassword: "password2" })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      email: "a@b.c",
      code: "123456",
      new_password: "password2",
    })
  })
})

describe("error handling", () => {
  it("clears the session on 401 and throws classified error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: "会话不存在或已过期" }))
    await expect(billingMe("bad")).rejects.toMatchObject({ status: 401 })
    expect(clearBillingSession).toHaveBeenCalledTimes(1)
  })

  it("surfaces the server detail message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { detail: "该邮箱已注册" }))
    await expect(billingRegister({ email: "a@b.c", password: "password1" })).rejects.toThrow(
      "该邮箱已注册",
    )
  })

  it("classifies a network failure as retryable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    const promise = billingLogin({ email: "a@b.c", password: "password1" })
    await expect(promise).rejects.toMatchObject({ name: "BillingApiError" })
    await expect(billingLogin({ email: "a@b.c", password: "password1" })).rejects.toSatisfy(
      (error: unknown) => getRequestErrorMeta(error).kind === "network",
    )
  })
})

describe("classifyBillingHttpError", () => {
  it.each([
    [401, "access-denied", false],
    [402, "access-denied", false],
    [409, "unknown", true],
    [429, "rate-limit", true],
    [422, "bad-request", false],
    [503, "unknown", true],
  ] as const)("status %i → kind %s retryable %s", (status, kind, isRetryable) => {
    const meta = getRequestErrorMeta(classifyBillingHttpError(status, "x"))
    expect(meta.statusCode).toBe(status)
    expect(meta.kind).toBe(kind)
    expect(meta.isRetryable).toBe(isRetryable)
  })

  it("is a BillingApiError carrying the message", () => {
    const error = classifyBillingHttpError(402, "余额不足")
    expect(error).toBeInstanceOf(BillingApiError)
    expect(error.message).toBe("余额不足")
  })
})
