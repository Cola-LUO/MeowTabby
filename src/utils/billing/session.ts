// src/utils/billing/session.ts
import type { BillingSession } from "./types"
import { storage } from "#imports"

/** chrome.storage.local（`local:` 前缀）——规格 §7.5。 */
export const BILLING_SESSION_STORAGE_KEY = "meowtabby-billing-session"

const STORAGE_KEY = `local:${BILLING_SESSION_STORAGE_KEY}`

export async function getBillingSession(): Promise<BillingSession | null> {
  try {
    const session = await storage.getItem<BillingSession>(STORAGE_KEY)
    if (!session || typeof session.sessionId !== "string" || session.sessionId.length === 0) {
      return null
    }
    return session
  } catch {
    return null
  }
}

export async function setBillingSession(
  input: Omit<BillingSession, "signedInAt">,
): Promise<BillingSession> {
  const session: BillingSession = { ...input, signedInAt: Date.now() }
  await storage.setItem(STORAGE_KEY, session)
  return session
}

export async function clearBillingSession(): Promise<void> {
  await storage.removeItem(STORAGE_KEY)
}

export function onBillingSessionChanged(
  callback: (session: BillingSession | null) => void,
): () => void {
  return storage.watch<BillingSession>(STORAGE_KEY, (newValue) => {
    callback(newValue ?? null)
  })
}
