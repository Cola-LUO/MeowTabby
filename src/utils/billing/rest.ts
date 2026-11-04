// src/utils/billing/rest.ts
import type { BillingLoginResult, BillingMe } from "./types"
import { env } from "@/env"
import { i18n } from "@/utils/i18n"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"
import { clearBillingSession } from "./session"

export class BillingApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "BillingApiError"
  }
}

/**
 * HTTP 状态 → 队列语义。挂在 RequestErrorMeta 上，供
 * defaultRequestRetryPolicy 裁决：401/402 抽干队列，429 暂停重试，
 * 5xx 普通重试（幂等键由调用方复用兜底）。
 */
export function classifyBillingHttpError(status: number, message: string): BillingApiError {
  const error = new BillingApiError(status, message)
  switch (status) {
    case 401:
    case 402:
      return attachRequestErrorMeta(error, {
        statusCode: status,
        kind: "access-denied",
        isRetryable: false,
      })
    case 429:
      return attachRequestErrorMeta(error, {
        statusCode: 429,
        kind: "rate-limit",
        isRetryable: true,
      })
    case 422:
      return attachRequestErrorMeta(error, {
        statusCode: 422,
        kind: "bad-request",
        isRetryable: false,
      })
    case 409:
      // 超时中止后 /v1/cancel 竞态失败时，后端仍持有订单在途；自动重试复用
      // 同一 request_id（规格 §6.3）会撞上 409。可安全重试：已结算的 id
      // 从缓存回放不会重复扣费，失败/已取消的 id 按新请求重入。
      return attachRequestErrorMeta(error, {
        statusCode: 409,
        kind: "unknown",
        isRetryable: true,
      })
    default:
      break
  }
  if (status >= 500 || status === 0) {
    return attachRequestErrorMeta(error, {
      statusCode: status || undefined,
      kind: status === 0 ? "network" : "unknown",
      isRetryable: true,
    })
  }
  return attachRequestErrorMeta(error, {
    statusCode: status,
    kind: "bad-request",
    isRetryable: false,
  })
}

interface BillingFetchOptions {
  method?: "GET" | "POST"
  body?: unknown
  sessionId?: string
}

async function billingJson<T>(path: string, options: BillingFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (options.sessionId) {
    headers.Authorization = `Bearer ${options.sessionId}`
  }

  let response: Response
  try {
    response = await fetch(`${env.WXT_BILLING_API_URL}${path}`, {
      method: options.method ?? "POST",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw classifyBillingHttpError(0, i18n.t("billing.errors.network"))
  }

  // 401 = 会话失效：本地立即清除，任何后续 UI 统一回落到未登录态（规格 §7.7）
  if (response.status === 401) {
    void clearBillingSession()
  }

  if (!response.ok) {
    let detail: string | undefined
    try {
      const parsed = (await response.json()) as { detail?: unknown }
      if (typeof parsed.detail === "string" && parsed.detail) {
        detail = parsed.detail
      }
    } catch {
      // 非 JSON 错误体：退回 statusText
    }
    throw classifyBillingHttpError(response.status, detail ?? response.statusText)
  }

  return (await response.json()) as T
}

export const billingRegister = (input: { email: string; password: string; displayName?: string }) =>
  billingJson<{ message: string; user_id: string; mail_sent: boolean }>("/register", {
    body: { email: input.email, password: input.password, display_name: input.displayName ?? "" },
  })

export const billingVerifyCode = (input: { email: string; code: string }) =>
  billingJson<{ message: string }>("/verify-code", { body: input })

export const billingResendVerify = (email: string) =>
  billingJson<{ message: string }>("/resend-verify", { body: { email } })

export const billingLogin = (input: { email: string; password: string }) =>
  billingJson<BillingLoginResult>("/login", { body: input })

export const billingLogout = (sessionId: string) =>
  billingJson<{ message: string }>("/logout", { sessionId })

export const billingForgotPassword = (email: string) =>
  billingJson<{ message: string }>("/forgot-password", { body: { email } })

export const billingResetPassword = (input: { email: string; code: string; newPassword: string }) =>
  billingJson<{ message: string }>("/reset-password", {
    body: { email: input.email, code: input.code, new_password: input.newPassword },
  })

export const billingMe = (sessionId: string) =>
  billingJson<BillingMe>("/me", { method: "GET", sessionId })

export const billingCancel = (sessionId: string, requestId: string) =>
  billingJson<{ message: string }>("/v1/cancel", { body: { request_id: requestId }, sessionId })
