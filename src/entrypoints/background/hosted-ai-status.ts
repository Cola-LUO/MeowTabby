import type { BillingHostedStatus } from "@/utils/billing/types"
import { storage } from "#imports"
import { BillingApiError, billingMe } from "@/utils/billing/rest"
import { getBillingSession, onBillingSessionChanged } from "@/utils/billing/session"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"

/**
 * 30s TTL 与原实现同理：折叠字幕播放的串行逐批 resolve，又让余额/登录态
 * 变化在数秒内浮出。陈旧判定不花钱——真实闸门在 /v1/generate 自己手里
 * （402/401），这里只决定"要不要发起"。
 */
const HOSTED_AI_STATUS_TTL_MS = 30_000

/**
 * Session storage：MV3 service worker 随时被回收，内存缓存活不过两批之间。
 */
const CACHE_KEY = "session:hostedAiStatus" as const

interface CachedStatus {
  status: BillingHostedStatus
  cachedAt: number
}

let inflight: Promise<BillingHostedStatus | null> | null = null

/**
 * 登录/退出即刻作废旧判定（会话存储变更 → 后台监听触发）。
 */
export async function clearHostedAiStatusCache(): Promise<void> {
  try {
    await storage.removeItem(CACHE_KEY)
  } catch (error) {
    logger.warn("[HostedAiStatus] Failed to clear cache:", error)
  }
}

async function readCachedStatus(): Promise<BillingHostedStatus | null> {
  try {
    const cached = await storage.getItem<CachedStatus>(CACHE_KEY)
    if (!cached || Date.now() - cached.cachedAt > HOSTED_AI_STATUS_TTL_MS) {
      return null
    }
    return cached.status
  } catch (error) {
    logger.warn("[HostedAiStatus] Failed to read cache:", error)
    return null
  }
}

const UNAUTHENTICATED: BillingHostedStatus = {
  authenticated: false,
  balanceYuan: null,
  email: null,
}

function fetchAndCache(): Promise<BillingHostedStatus | null> {
  inflight ??= (async (): Promise<BillingHostedStatus | null> => {
    const session = await getBillingSession()
    if (!session) {
      return UNAUTHENTICATED
    }
    try {
      const me = await billingMe(session.sessionId)
      return { authenticated: true, balanceYuan: me.balance, email: me.email }
    } catch (error) {
      if (error instanceof BillingApiError && error.status === 401) {
        // 会话服务端已失效（rest 层已清本地）：未登录判定
        return UNAUTHENTICATED
      }
      // Fail open：调用方把 null 当"无判定"，/v1/generate 自己把关。
      logger.warn("[HostedAiStatus] Billing status fetch failed:", error)
      return null
    }
  })()
    .then(async (status) => {
      if (status !== null) {
        try {
          await storage.setItem<CachedStatus>(CACHE_KEY, { status, cachedAt: Date.now() })
        } catch (error) {
          logger.warn("[HostedAiStatus] Failed to write cache:", error)
        }
      }
      return status
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}

export function setupHostedAiStatusHandler(): void {
  onBillingSessionChanged(() => {
    void clearHostedAiStatusCache()
  })
  onMessage("getHostedAiStatus", async () => {
    return (await readCachedStatus()) ?? (await fetchAndCache())
  })
}
