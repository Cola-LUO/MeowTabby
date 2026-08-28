import type { BillingSession } from "@/utils/billing/types"
import { IconLogout, IconWallet } from "@tabler/icons-react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import guest from "@/assets/icons/avatars/guest.svg"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/base-ui/avatar"
import { DropdownMenuItem } from "@/components/ui/base-ui/dropdown-menu"
import { billingLogout, billingMe } from "@/utils/billing/rest"
import {
  clearBillingSession,
  getBillingSession,
  onBillingSessionChanged,
} from "@/utils/billing/session"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { cn } from "@/utils/styles/utils"

export const ACCOUNT_STATE = {
  LOADING: "loading",
  GUEST: "guest",
  AUTHED: "authed",
} as const

type AccountState = (typeof ACCOUNT_STATE)[keyof typeof ACCOUNT_STATE]
type AccountMenu = ReturnType<typeof useUserAccountMenu>

function getUserInitials(name: string | null | undefined) {
  const normalizedName = name?.trim()
  if (!normalizedName) return "U"

  const parts = normalizedName.split(/\s+/)
  const initials =
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`
      : Array.from(normalizedName).slice(0, 2).join("")

  return initials.toUpperCase()
}

export function openAccountSettings() {
  void sendMessage("openOptionsPage", { route: "/account" })
}

export function useUserAccountMenu() {
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
    enabled: session !== null,
    retry: false,
    staleTime: 60_000,
    meta: { suppressToast: true },
  })

  const logout = useMutation({
    mutationFn: async () => {
      if (!session) return
      try {
        await billingLogout(session.sessionId)
      } finally {
        // 服务端吊销失败也清本地：用户意图是退出，残留会话只会造成 401 循环
        await clearBillingSession()
      }
    },
    meta: { errorDescription: i18n.t("account.logoutError") },
  })

  const state: AccountState = sessionPending
    ? ACCOUNT_STATE.LOADING
    : !session
      ? ACCOUNT_STATE.GUEST
      : ACCOUNT_STATE.AUTHED

  const displayName = meQuery.data?.display_name ?? session?.displayName ?? session?.email

  return {
    state,
    session,
    email: session?.email,
    displayName: displayName || "Guest",
    balanceYuan: meQuery.data?.balance,
    isPending: sessionPending,
    logout,
    openAccountSettings,
    avatarSrc: session ? "" : guest,
    fallbackText: session ? getUserInitials(displayName) : "G",
  }
}

export function AccountNameWithBalance({
  account,
  className,
}: {
  account: AccountMenu
  className?: string
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span className="truncate font-medium">{account.displayName}</span>
      {account.balanceYuan !== undefined && (
        <span className="shrink-0 text-xs text-muted-foreground">¥{account.balanceYuan}</span>
      )}
    </span>
  )
}

export function AccountAvatar({
  account,
  size = "sm",
}: {
  account: AccountMenu
  size?: "default" | "sm" | "lg"
}) {
  return (
    <Avatar size={size} className={cn(account.isPending && "animate-pulse")}>
      <AvatarImage src={account.avatarSrc || ""} alt={account.displayName} />
      <AvatarFallback>{account.fallbackText}</AvatarFallback>
    </Avatar>
  )
}

export function AccountDetails({ account }: { account: AccountMenu }) {
  return (
    <div className="flex items-center gap-2 px-1.5 py-1.5">
      <AccountAvatar account={account} />
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <AccountNameWithBalance account={account} className="text-foreground" />
        {account.email && (
          <span className="truncate text-xs font-normal text-muted-foreground">
            {account.email}
          </span>
        )}
      </div>
    </div>
  )
}

export function RechargeMenuItem({ account }: { account: AccountMenu }) {
  return (
    <DropdownMenuItem
      onClick={account.openAccountSettings}
      className="cursor-pointer transition-colors"
    >
      <IconWallet aria-hidden />
      {i18n.t("billing.account.recharge")}
    </DropdownMenuItem>
  )
}

export function LogoutMenuItem({ account }: { account: AccountMenu }) {
  const { logout } = account
  return (
    <DropdownMenuItem
      variant="destructive"
      disabled={logout.isPending}
      onClick={() => logout.mutate()}
      className="cursor-pointer transition-colors"
    >
      <IconLogout aria-hidden className={cn(logout.isPending && "animate-pulse")} />
      {i18n.t("account.logout")}
    </DropdownMenuItem>
  )
}
