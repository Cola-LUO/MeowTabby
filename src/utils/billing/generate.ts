// src/utils/billing/generate.ts
import type { BillingFeature } from "./types"
import { env } from "@/env"
import { i18n } from "@/utils/i18n"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"
import { BillingApiError, billingCancel, classifyBillingHttpError } from "./rest"
import { clearBillingSession, getBillingSession } from "./session"
import { readBillingSseEvents } from "./sse"

export interface BillingGenerateInput {
  systemPrompt: string
  prompt: string
  requestId: string
  feature: BillingFeature
  maxOutputTokens?: number
}

async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const parsed = (await response.json()) as { detail?: unknown }
    return typeof parsed.detail === "string" && parsed.detail ? parsed.detail : undefined
  } catch {
    return undefined
  }
}

function parseJsonField(data: string, field: string): unknown {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>
    return parsed[field]
  } catch {
    return undefined
  }
}

/**
 * 对 billing-backend 的 /v1/generate 发 SSE 请求，产出与
 * `consumeTextPartStream` 兼容的 parts 流。规格 §6.1 的运输层替换核心：
 * - 未登录 → 401 access-denied（闸门文案）
 * - 流前 HTTP 错误 → classifyBillingHttpError（402/401/429/5xx 各自语义）
 * - 流中 `error` 事件 → 抛错（重试由 RequestQueue 用同一 requestId 兜底）
 * - abort → 通知后端掐上游（规格 §6.5；后端按已生成部分结算）
 */
export async function createBillingTextPartStream(
  input: BillingGenerateInput,
  signal?: AbortSignal,
): Promise<AsyncIterable<Record<string, unknown>>> {
  const session = await getBillingSession()
  if (!session) {
    throw classifyBillingHttpError(401, i18n.t("hostedAi.availability.authenticationRequired"))
  }

  let response: Response
  try {
    response = await fetch(`${env.WXT_BILLING_API_URL}/v1/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${session.sessionId}`,
      },
      body: JSON.stringify({
        request_id: input.requestId,
        feature: input.feature,
        system_prompt: input.systemPrompt,
        prompt: input.prompt,
        ...(input.maxOutputTokens !== undefined
          ? { max_output_tokens: input.maxOutputTokens }
          : {}),
      }),
      signal,
    })
  } catch {
    if (signal?.aborted) {
      throw new DOMException("stream aborted", "AbortError")
    }
    throw classifyBillingHttpError(0, i18n.t("billing.errors.network"))
  }

  if (!response.ok) {
    if (response.status === 401) {
      await clearBillingSession()
      throw classifyBillingHttpError(401, i18n.t("billing.errors.sessionExpired"))
    }
    const detail = await readErrorDetail(response)
    if (response.status === 402) {
      throw classifyBillingHttpError(402, detail ?? i18n.t("billing.errors.balanceInsufficient"))
    }
    throw classifyBillingHttpError(response.status, detail ?? response.statusText)
  }

  if (!response.body) {
    throw classifyBillingHttpError(502, i18n.t("billing.errors.generic"))
  }

  const sessionId = session.sessionId
  const requestId = input.requestId
  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        void billingCancel(sessionId, requestId).catch(() => {
          // 取消是尽力而为：后端在途=1 且有超时兜底，失败不升级为用户错误
        })
      },
      { once: true },
    )
  }

  const events = readBillingSseEvents(response.body)
  return (async function* () {
    for await (const sseEvent of events) {
      if (signal?.aborted) {
        throw new DOMException("stream aborted", "AbortError")
      }
      switch (sseEvent.event) {
        case "delta": {
          const text = parseJsonField(sseEvent.data, "text") as string | undefined
          yield { type: "text-delta", text: typeof text === "string" ? text : "" }
          break
        }
        case "done": {
          yield { type: "finish", finishReason: "stop" }
          break
        }
        case "error": {
          const detail = parseJsonField(sseEvent.data, "detail") as string | undefined
          throw attachRequestErrorMeta(
            new BillingApiError(502, detail || i18n.t("billing.errors.generic")),
            { statusCode: 502, kind: "unknown", isRetryable: true },
          )
        }
        default:
          break
      }
    }
  })()
}
