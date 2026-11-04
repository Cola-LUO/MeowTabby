import type { BillingSession } from "@/utils/billing/types"
import {
  clearBillingSession,
  getBillingSession,
  onBillingSessionChanged,
  setBillingSession,
} from "@/utils/billing/session"

const REQUEST = "meowtabby-support-page"
const RESPONSE = "meowtabby-support-extension"

function onSupportPage() {
  return (
    window.location.pathname === "/meowtabby/support" ||
    window.location.pathname === "/meowtabby/support/"
  )
}

function validSession(value: unknown): value is BillingSession {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return (
    typeof item.sessionId === "string" &&
    item.sessionId.length > 0 &&
    typeof item.email === "string" &&
    typeof item.displayName !== "undefined"
  )
}

export function startBillingSessionBridge() {
  if (!onSupportPage()) return () => {}
  const respond = (type: string, requestId: string, session: BillingSession | null) => {
    if (!onSupportPage()) return
    window.postMessage({ source: RESPONSE, type, requestId, session }, window.location.origin)
  }
  const onMessage = async (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin || !onSupportPage())
      return
    const data = event.data
    if (!data || data.source !== REQUEST || typeof data.requestId !== "string" || !data.requestId)
      return
    if (data.type === "get") {
      respond("state", data.requestId, await getBillingSession())
    } else if (data.type === "set" && validSession(data.session)) {
      const session = await setBillingSession(data.session)
      respond("state", data.requestId, session)
    } else if (data.type === "clear") {
      await clearBillingSession()
      respond("state", data.requestId, null)
    }
  }
  window.addEventListener("message", onMessage)
  const unwatch = onBillingSessionChanged((session) => respond("changed", "", session))
  return () => {
    window.removeEventListener("message", onMessage)
    unwatch()
  }
}
