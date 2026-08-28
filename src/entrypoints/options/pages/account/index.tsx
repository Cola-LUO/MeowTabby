import type { BillingSession } from "@/utils/billing/types"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import { Label } from "@/components/ui/base-ui/label"
import {
  billingForgotPassword,
  billingLogin,
  billingLogout,
  billingMe,
  billingRegister,
  billingResendVerify,
  billingResetPassword,
  billingVerifyCode,
} from "@/utils/billing/rest"
import {
  clearBillingSession,
  getBillingSession,
  onBillingSessionChanged,
  setBillingSession,
} from "@/utils/billing/session"
import { i18n } from "@/utils/i18n"
import { logger } from "@/utils/logger"
import { ConfigSection } from "../../components/config-section"
import { PageLayout } from "../../components/page-layout"

type AuthView = "login" | "register" | "verify" | "reset-request"

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="text-sm text-destructive">{message}</p>
}

function LoginForm({
  onSession,
  onSwitchView,
}: {
  onSession: (session: BillingSession) => void
  onSwitchView: (view: AuthView) => void
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const login = useMutation({
    mutationFn: async () => {
      const result = await billingLogin({ email, password })
      return setBillingSession({ sessionId: result.session_id, email, displayName: null })
    },
    onSuccess: onSession,
    onError: (err: Error) => setError(err.message),
  })

  return (
    <form
      className="grid max-w-sm gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        login.mutate()
      }}
    >
      <h3 className="text-2xl font-medium">{i18n.t("billing.login.title")}</h3>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-login-email">{i18n.t("billing.login.email")}</Label>
        <Input
          id="billing-login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-login-password">{i18n.t("billing.login.password")}</Label>
        <Input
          id="billing-login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      <ErrorText message={error} />
      <Button type="submit" disabled={login.isPending}>
        {i18n.t("billing.login.submit")}
      </Button>
      <div className="flex justify-between text-sm">
        <button
          type="button"
          className="cursor-pointer text-primary"
          onClick={() => onSwitchView("reset-request")}
        >
          {i18n.t("billing.login.forgotPassword")}
        </button>
        <button
          type="button"
          className="cursor-pointer text-primary"
          onClick={() => onSwitchView("register")}
        >
          {i18n.t("billing.login.switchToRegister")}
        </button>
      </div>
    </form>
  )
}

function RegisterForm({
  onRegistered,
  onSwitchView,
}: {
  onRegistered: (pending: { displayName: string; email: string; password: string }) => void
  onSwitchView: (view: AuthView) => void
}) {
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const register = useMutation({
    mutationFn: () => billingRegister({ email, password, displayName }),
    onSuccess: () => onRegistered({ displayName, email, password }),
    onError: (err: Error) => setError(err.message),
  })

  return (
    <form
      className="grid max-w-sm gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        register.mutate()
      }}
    >
      <h3 className="text-2xl font-medium">{i18n.t("billing.register.title")}</h3>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-register-name">{i18n.t("billing.register.displayName")}</Label>
        <Input
          id="billing-register-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-register-email">{i18n.t("billing.register.email")}</Label>
        <Input
          id="billing-register-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-register-password">{i18n.t("billing.register.password")}</Label>
        <Input
          id="billing-register-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      <ErrorText message={error} />
      <Button type="submit" disabled={register.isPending}>
        {i18n.t("billing.register.submit")}
      </Button>
      <button
        type="button"
        className="cursor-pointer text-left text-sm text-primary"
        onClick={() => onSwitchView("login")}
      >
        {i18n.t("billing.register.switchToLogin")}
      </button>
    </form>
  )
}

function VerifyCodeForm({
  pending,
  onSession,
}: {
  pending: { displayName: string; email: string; password: string }
  onSession: (session: BillingSession) => void
}) {
  const [code, setCode] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 激活成功后立即用同邮箱+密码登录（/verify-code 只激活不发会话）
  const verify = useMutation({
    mutationFn: async () => {
      await billingVerifyCode({ email: pending.email, code })
      const result = await billingLogin({ email: pending.email, password: pending.password })
      return setBillingSession({
        sessionId: result.session_id,
        email: pending.email,
        displayName: pending.displayName || null,
      })
    },
    onSuccess: onSession,
    onError: (err: Error) => setError(err.message),
  })

  const resend = useMutation({
    mutationFn: () => billingResendVerify(pending.email),
    onSuccess: () => {
      setNotice(i18n.t("billing.register.resendSuccess"))
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <form
      className="grid max-w-sm gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        setNotice(null)
        verify.mutate()
      }}
    >
      <h3 className="text-sm font-medium">{i18n.t("billing.register.codeTitle")}</h3>
      <p className="text-sm text-muted-foreground">
        {i18n.t("billing.register.codeDescription", [pending.email])}
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-verify-code">{i18n.t("billing.register.code")}</Label>
        <Input
          id="billing-verify-code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          required
        />
      </div>
      <ErrorText message={error} />
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <Button type="submit" disabled={verify.isPending || code.length !== 6}>
        {i18n.t("billing.register.verify")}
      </Button>
      <button
        type="button"
        className="cursor-pointer text-left text-sm text-primary"
        disabled={resend.isPending}
        onClick={() => resend.mutate()}
      >
        {i18n.t("billing.register.resend")}
      </button>
    </form>
  )
}

function ResetPasswordForms({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<"request" | "confirm">("request")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sendCode = useMutation({
    mutationFn: () => billingForgotPassword(email),
    onSuccess: () => {
      setStage("confirm")
      setNotice(i18n.t("billing.reset.codeSent", [email]))
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const reset = useMutation({
    mutationFn: () => billingResetPassword({ email, code, newPassword }),
    onSuccess: onDone,
    onError: (err: Error) => setError(err.message),
  })

  if (stage === "request") {
    return (
      <form
        className="grid max-w-sm gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setError(null)
          sendCode.mutate()
        }}
      >
        <p className="text-sm text-muted-foreground">
          {i18n.t("billing.reset.requestDescription")}
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="billing-reset-email">{i18n.t("billing.login.email")}</Label>
          <Input
            id="billing-reset-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <ErrorText message={error} />
        <Button type="submit" disabled={sendCode.isPending}>
          {i18n.t("billing.reset.sendCode")}
        </Button>
      </form>
    )
  }

  return (
    <form
      className="grid max-w-sm gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        reset.mutate()
      }}
    >
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="billing-reset-code">{i18n.t("billing.reset.code")}</Label>
        <Input
          id="billing-reset-code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-reset-password">{i18n.t("billing.reset.newPassword")}</Label>
        <Input
          id="billing-reset-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />
      </div>
      <ErrorText message={error} />
      <Button type="submit" disabled={reset.isPending || code.length !== 6}>
        {i18n.t("billing.reset.submit")}
      </Button>
    </form>
  )
}

function AccountAuthForms({ onSession }: { onSession: (session: BillingSession) => void }) {
  const [view, setView] = useState<AuthView>("login")
  const [pendingRegistration, setPendingRegistration] = useState<{
    displayName: string
    email: string
    password: string
  } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <ConfigSection id="billing-account-auth" title={i18n.t("billing.account.title")}>
      <p className="text-sm text-muted-foreground">{i18n.t("billing.account.loginOrRegister")}</p>
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      {view === "login" && (
        <LoginForm
          onSession={onSession}
          onSwitchView={(next) => {
            setNotice(null)
            setView(next)
          }}
        />
      )}
      {view === "register" && (
        <RegisterForm
          onRegistered={(pending) => {
            setPendingRegistration(pending)
            setView("verify")
          }}
          onSwitchView={(next) => {
            setNotice(null)
            setView(next)
          }}
        />
      )}
      {view === "verify" && pendingRegistration && (
        <VerifyCodeForm pending={pendingRegistration} onSession={onSession} />
      )}
      {view === "reset-request" && (
        <ResetPasswordForms
          onDone={() => {
            setNotice(i18n.t("billing.reset.success"))
            setView("login")
          }}
        />
      )}
      {view !== "login" && (
        <button
          type="button"
          className="cursor-pointer text-left text-sm text-primary"
          onClick={() => {
            setNotice(null)
            setView("login")
          }}
        >
          {i18n.t("billing.reset.backToLogin")}
        </button>
      )}
    </ConfigSection>
  )
}

function AccountOverview({ session }: { session: BillingSession }) {
  const meQuery = useQuery({
    queryKey: ["billing", "me", session.sessionId],
    queryFn: () => billingMe(session.sessionId),
    retry: false,
    staleTime: 60_000,
  })

  const logout = useMutation({
    mutationFn: async () => {
      try {
        await billingLogout(session.sessionId)
      } catch (error) {
        logger.warn("[billing] logout request failed, clearing local session anyway:", error)
      }
      await clearBillingSession()
    },
    meta: { errorDescription: i18n.t("account.logoutError") },
  })

  return (
    <ConfigSection id="billing-account-overview" title={i18n.t("billing.account.title")}>
      <div className="grid max-w-sm gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{i18n.t("billing.login.email")}</span>
          <span>{meQuery.data?.email ?? session.email}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{i18n.t("billing.account.balance")}</span>
          <span className="font-medium">
            {meQuery.isPending ? "…" : (meQuery.data?.balance ?? "—")}
          </span>
        </div>
      </div>
      <div className="grid max-w-sm gap-3">
        <p className="text-sm text-muted-foreground">{i18n.t("billing.account.rechargeGuide")}</p>
        <Button variant="outline" disabled={logout.isPending} onClick={() => logout.mutate()}>
          {i18n.t("account.logout")}
        </Button>
      </div>
    </ConfigSection>
  )
}

export function AccountPage() {
  const [session, setSession] = useState<BillingSession | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)

  useEffect(() => {
    let active = true
    void getBillingSession().then((value) => {
      if (!active) return
      setSession(value)
      setSessionLoading(false)
    })
    const unwatch = onBillingSessionChanged((value) => {
      setSession(value)
    })
    return () => {
      active = false
      unwatch()
    }
  }, [])

  if (sessionLoading) {
    return null
  }

  return (
    <PageLayout
      title={i18n.t("options.account.title")}
      description={
        <span className="whitespace-pre-line">{i18n.t("options.account.description")}</span>
      }
    >
      {session ? (
        <AccountOverview session={session} />
      ) : (
        <AccountAuthForms onSession={setSession} />
      )}
    </PageLayout>
  )
}
