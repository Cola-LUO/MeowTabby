import type { SystemProviderRef } from "./provider-registry"
import type { HostedAiTextStreamRoute } from "@/types/background-stream"
import type { Config } from "@/types/config/config"
import type { TranslateProviderConfig } from "@/types/config/provider"
import type { BillingHostedStatus } from "@/utils/billing/types"
import type { HostedAiFeature } from "@/utils/hosted-ai/types"
import { isLLMProviderConfig } from "@/types/config/provider"
import { BILLING_MODEL_REVISION } from "@/utils/billing/types"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { resolveProviderRefForCapability } from "./provider-registry"

/**
 * A resolved provider with the local wrapper stripped — either the local
 * config itself or the system ref. Callers unwrap `ResolvedProviderRef` into
 * this because most of them go on to inspect the config directly (`provider
 * !== "deeplx"`, `isLLMProviderConfig`) rather than the ref around it.
 *
 * `TranslateProviderConfig` is the wider of the registry's two capability
 * predicates (`LLMProviderConfig` is a subset of it), so every feature that
 * serializes a ref fits here, including the LLM-only ones. This type therefore
 * does not constrain which provider may run which feature — callers do, by
 * resolving through `resolveProviderRefForCapability` first.
 */
export type UnwrappedProviderRef = TranslateProviderConfig | SystemProviderRef

/**
 * A provider flattened for structured-clone transport to the background. Local
 * providers carry their whole config; system providers carry only what the
 * hosted call and the cache key need — the tier to bill and the model revision
 * that identifies the output.
 */
export type SerializableProviderRef =
  | { kind: "local"; config: TranslateProviderConfig }
  | {
      kind: "system"
      providerId: SystemProviderRef["id"]
      modelTier: SystemProviderRef["modelTier"]
      modelRevision: string
    }

export class HostedAiProviderUnavailableError extends Error {
  constructor(
    readonly provider: SystemProviderRef,
    message: string,
  ) {
    super(message)
    this.name = "HostedAiProviderUnavailableError"
  }
}

export function resolvePageTranslationProvider(config: Config): UnwrappedProviderRef {
  const resolved = resolveProviderRefForCapability(
    "pageTranslation",
    config.providersConfig,
    config.pageTranslation.providerId,
  )
  if (!resolved) {
    throw new Error(`No page translation provider for id "${config.pageTranslation.providerId}"`)
  }
  return resolved.kind === "local" ? resolved.config : resolved
}

export function resolvePageTranslationProviderOrNull(config: Config): UnwrappedProviderRef | null {
  try {
    return resolvePageTranslationProvider(config)
  } catch {
    return null
  }
}

export function isSystemProviderRef(provider: UnwrappedProviderRef): provider is SystemProviderRef {
  return "kind" in provider && provider.kind === "system"
}

/**
 * Cache identity for a provider. Local providers hash their whole config, so a
 * changed key or temperature invalidates; system providers hash the model
 * revision the backend actually serves (BILLING_MODEL_REVISION), which is what
 * changes when the output changes. One helper so every cache (page, subtitles,
 * summaries, segmentation) keys the same way — a local ref still stringifies
 * byte-identically to what those caches used before, so existing BYOK entries
 * survive.
 */
export function getProviderCacheIdentity(ref: SerializableProviderRef): string {
  return ref.kind === "local"
    ? JSON.stringify(ref.config)
    : JSON.stringify({ providerId: ref.providerId, modelRevision: ref.modelRevision })
}

/**
 * Whether this ref can be prompted for free-form text.
 *
 * Capability and promptability are not the same question. A feature's provider
 * list is capability-gated — `videoSubtitles` admits any translate provider —
 * but a summary is a generation, and Google, Microsoft and DeepLX have no model
 * to prompt. Without this, enqueueing a summary for a translate-only subtitles
 * provider is admitted to the queue and can only ever throw, after burning its
 * retries.
 */
export function canProviderRefGenerateText(ref: SerializableProviderRef): boolean {
  return ref.kind === "system" || isLLMProviderConfig(ref.config)
}

/**
 * Routes map many-to-one onto features: both subtitle routes bill against
 * `videoSubtitles`. The status gate is per feature, so collapse first.
 */
export function getHostedFeatureForRoute(route: HostedAiTextStreamRoute): HostedAiFeature {
  return route === "videoSubtitlesSegmentation" ? "videoSubtitles" : route
}

/**
 * The in-flight status ask, shared by every caller in this frame that overlaps
 * it.
 *
 * One status response covers all features and tiers, but resolution happens per
 * unit of work: page translation resolves per paragraph and runs paragraphs in
 * parallel, subtitles resolve per cue batch. Without coalescing, each of those
 * issues its own round trip for the same answer, and every one of them is
 * serialized ahead of the work it gates.
 *
 * Coalescing and caching solve different halves of that: this collapses callers
 * that overlap, and the background's short-TTL entry collapses the serialized
 * ones that do not (a subtitle run resolves one batch at a time, so it never
 * overlaps itself). Both are needed.
 */
let inflightStatus: Promise<BillingHostedStatus | undefined> | null = null

/**
 * The background owns the response and its cache — content scripts cannot read
 * the session storage it lives in, and one entry there serves every tab.
 */
export function fetchHostedAiStatus(): Promise<BillingHostedStatus | undefined> {
  if (inflightStatus) {
    return inflightStatus
  }

  // Fail open when the status endpoint is unreachable: the generation endpoints
  // enforce access on their own, so a status-only outage must not block
  // translation. Only an explicit server verdict blocks, in
  // `serializeProviderRef`. Both the null verdict and the throw collapse to the
  // same `undefined` here, and inside the shared promise so every sharer sees it.
  const pending = (async (): Promise<BillingHostedStatus | undefined> => {
    try {
      return (await sendMessage("getHostedAiStatus")) ?? undefined
    } catch {
      return undefined
    }
  })()

  inflightStatus = pending.finally(() => {
    inflightStatus = null
  })

  return inflightStatus
}

/**
 * The billing gate is the sign-in state only: the backend answers an
 * unauthenticated or out-of-balance /v1/generate itself (401/402), and those
 * responses carry the error classification that decides what the user sees.
 * `route` stays in the signature so callers keep naming the feature they run;
 * the verdict itself is one for all routes.
 */
export async function serializeProviderRef(
  provider: UnwrappedProviderRef,
  route: HostedAiTextStreamRoute,
): Promise<SerializableProviderRef> {
  if (!isSystemProviderRef(provider)) {
    return { kind: "local", config: provider }
  }

  void route

  const status = await fetchHostedAiStatus()

  // billing 闸门 = 登录态。余额不在这里查：后端 402 兜底并把"充值引导"
  // 交给错误分级（规格 §6.3），闸门保持轻量。
  if (status && !status.authenticated) {
    throw new HostedAiProviderUnavailableError(
      provider,
      i18n.t("hostedAi.availability.authenticationRequired"),
    )
  }

  return {
    kind: "system",
    providerId: provider.id,
    modelTier: provider.modelTier,
    modelRevision: BILLING_MODEL_REVISION,
  }
}

export type ProviderAvailability =
  | { available: true; providerRef: SerializableProviderRef }
  | { available: false; message: string }

export async function checkProviderAvailability(
  provider: UnwrappedProviderRef,
  route: HostedAiTextStreamRoute,
): Promise<ProviderAvailability> {
  try {
    return { available: true, providerRef: await serializeProviderRef(provider, route) }
  } catch (error) {
    if (error instanceof HostedAiProviderUnavailableError) {
      return { available: false, message: error.message }
    }
    throw error
  }
}
