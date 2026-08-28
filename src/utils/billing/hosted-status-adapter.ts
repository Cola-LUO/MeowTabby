import type { HostedAiStatus, HostedAiTierStatus } from "@/utils/hosted-ai/types"
import { BILLING_MODEL_REVISION } from "./types"

function tierStatus(authenticated: boolean): HostedAiTierStatus {
  return authenticated
    ? {
        accessAllowed: true,
        available: true,
        unavailableReason: null,
        requiresUltra: false,
        modelRevision: BILLING_MODEL_REVISION,
      }
    : {
        accessAllowed: false,
        available: false,
        unavailableReason: "authentication_required",
        requiresUltra: false,
        modelRevision: BILLING_MODEL_REVISION,
      }
}

/**
 * billing 世界没有 readfrog 的分层配额：单模型、单余额。为让既有
 * 6 个 UI 消费者（provider 下拉装饰、语言检测页、popup 等）零改动，
 * 把登录态合成回 readfrog 的 `HostedAiStatus` 形状——未登录即
 * `authentication_required`（装饰器把内置 provider 置灰并提示登录），
 * 登录即全部可用（余额闸门在 /v1/generate 的 402）。
 */
export function buildHostedAiStatusFromBilling(authenticated: boolean): HostedAiStatus {
  const featureStatus = { normal: tierStatus(authenticated), advance: tierStatus(authenticated) }
  return {
    credits: [],
    features: {
      pageTranslation: featureStatus,
      customAction: featureStatus,
      noteSuggestion: featureStatus,
      selectionTranslation: featureStatus,
      videoSubtitles: featureStatus,
      inputTranslation: featureStatus,
      languageDetection: featureStatus,
    },
  }
}
