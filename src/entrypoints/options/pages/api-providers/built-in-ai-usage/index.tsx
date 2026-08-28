import { useHostedAiStatus } from "@/components/llm-providers/use-hosted-ai-status"
import { Button } from "@/components/ui/base-ui/button"
import { Skeleton } from "@/components/ui/base-ui/skeleton"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { ConfigSection } from "../../../components/config-section"

/**
 * billing 时代没有配额池：单余额、扣到零。余额数字 + 充值入口
 * （充值为管理员手动操作，规格 §7.6 的引导式入口）。
 */
export function BuiltInAiUsageConfig() {
  const { isSignedIn, isPending, balanceYuan } = useHostedAiStatus()

  // 未登录用户没有余额可展示；登录引导由 provider 置灰 + 账户页承担。
  if (!isSignedIn) {
    return null
  }

  return (
    <ConfigSection
      id="built-in-ai-usage"
      title={i18n.t("options.apiProviders.builtInAiUsage.title")}
    >
      {isPending ? (
        <Skeleton className="h-13 w-full" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-muted-foreground">{i18n.t("billing.account.balance")}</span>
            <span className="text-base font-medium tabular-nums">¥{balanceYuan ?? "…"}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void sendMessage("openOptionsPage", { route: "/account" })}
          >
            {i18n.t("billing.account.recharge")}
          </Button>
        </div>
      )}
    </ConfigSection>
  )
}
