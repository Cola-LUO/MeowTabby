import type { HostedAiTextStreamRoute } from "./background-stream"
import type { BillingFeature } from "@/utils/billing/types"
import type { SerializableProviderRef } from "@/utils/providers/provider-ref"

export interface BackgroundGenerateTextPayload {
  providerRef: SerializableProviderRef
  /**
   * Which hosted route a system provider bills against. Ignored for local
   * providers, which have no server-side quota.
   */
  hostedFeature: HostedAiTextStreamRoute
  instructions: string
  prompt: string
  /**
   * Hosted billing idempotency key. Mint a fresh one per real model call — a
   * retry after an unusable answer is a new call, and reusing the key would
   * replay the original response.
   */
  requestId?: string
  /** Billing feature label override — summaries bill as "summarization". */
  billingTag?: BillingFeature
  /**
   * Output budget forwarded to the billing backend. Whole-block outputs such
   * as subtitle segmentation outgrow the default 4096 tokens and would
   * finish with `finishReason: "length"`; backend hard cap is 8192 (spec §3.2).
   */
  maxOutputTokens?: number
  /** Local providers only; hosted retries are the caller's business. */
  maxRetries?: number
}

export interface BackgroundGenerateTextResponse {
  text: string
}
