import type { BillingSession } from "@/utils/billing/types"
import type { HostedAiStatus } from "@/utils/hosted-ai/types"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { buildHostedAiStatusFromBilling } from "@/utils/billing/hosted-status-adapter"
import { billingMe } from "@/utils/billing/rest"
import { getBillingSession, onBillingSessionChanged } from "@/utils/billing/session"

export interface HostedAiStatusResult {
  status: HostedAiStatus | undefined
  /** billing 余额元字符串（如 "1.2345"）；未登录/未知为 undefined */
  balanceYuan: string | undefined
  /** False until the session resolves, so guest-only UI never flashes for members. */
  isSignedIn: boolean
  isPending: boolean
  isError: boolean
}

/**
 * 数据源从 readfrog hostedAi.status 换成 billing（会话 + /me）。返回形状
 * 保持 `HostedAiStatus`（合成），provider 下拉装饰等消费者零改动。
 * 与后台 `getHostedAiStatus` 缓存仍是两套：这里渲染实时数字，后台那份
 * 决定要不要发起调用。
 */
export function useHostedAiStatus(options: { enabled?: boolean } = {}): HostedAiStatusResult {
  const [session, setSession] = useState<BillingSession | null>(null)
  const [sessionPending, setSessionPending] = useState(true)

  useEffect(() => {
    let active = true
    void getBillingSession().then((value) => {
      if (!active) return
      setSession(value)
      setSessionPending(false)
    })
    const unwatch = onBillingSessionChanged((value) => setSession(value))
    return () => {
      active = false
      unwatch()
    }
  }, [])

  const meQuery = useQuery({
    queryKey: ["billing", "me", session?.sessionId ?? "guest"],
    queryFn: () => billingMe(session!.sessionId),
    enabled: (options.enabled ?? true) && session !== null,
    retry: false,
    staleTime: 60_000,
    meta: { suppressToast: true },
  })

  const isSignedIn = session !== null
  // /me 在途或失败都按"已登录、可用"呈现（fail open）：真实闸门在
  // /v1/generate，一次余额查询抖动不该把内置 provider 全部置灰。
  const status = useMemo(
    () => (sessionPending ? undefined : buildHostedAiStatusFromBilling(isSignedIn)),
    [sessionPending, isSignedIn],
  )

  return {
    status,
    balanceYuan: meQuery.data?.balance,
    isSignedIn,
    isPending: sessionPending || (isSignedIn && meQuery.isPending),
    isError: meQuery.isError,
  }
}
