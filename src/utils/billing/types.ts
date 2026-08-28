// src/utils/billing/types.ts

/** billing-backend 功能标签（规格 §3.2，服务端只存储不解析）。 */
export type BillingFeature =
  | "pageTranslation"
  | "selectionTranslation"
  | "inputTranslation"
  | "videoSubtitles"
  | "videoSubtitlesSegmentation"
  | "languageDetection"
  | "summarization"

export interface BillingSession {
  sessionId: string
  email: string
  displayName: string | null
  signedInAt: number
}

/** 背景托管 AI 可用性判定（替代 readfrog hostedAi.status）。 */
export interface BillingHostedStatus {
  authenticated: boolean
  /** /me 的元字符串（4 位小数，如 "12.3400"）；null = 未知 */
  balanceYuan: string | null
  email: string | null
}

/**
 * 后端只有一个模型，缓存身份固定。后端换模型时手动升版本，
 * 让既有翻译缓存整体失效重算。
 */
export const BILLING_MODEL_REVISION = "billing-v1"

export interface BillingRecentCall {
  id: number
  timestamp: string
  ok: boolean
  total_tokens: number
  cache_hit: number
  cache_miss: number
  latency_ms: number
  cost: string
  error: string | null
}

export interface BillingMe {
  user_id: string
  email: string
  display_name: string | null
  email_verified: boolean
  balance: string
  total_recharged: string
  total_spent: string
  total_tokens: number
  recent_calls: BillingRecentCall[]
}

export interface BillingLoginResult {
  session_id: string
  user_id: string
  expires_in_days: number
}
