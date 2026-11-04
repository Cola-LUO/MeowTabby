// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://netxmeow.top/meowtabby/support/"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({
  getBillingSession: vi.fn<() => Promise<unknown>>(),
  setBillingSession: vi.fn<(value: unknown) => Promise<unknown>>(),
  clearBillingSession: vi.fn<() => Promise<void>>(),
  onBillingSessionChanged: vi.fn<(callback: (value: unknown) => void) => () => void>(),
}))
vi.mock("@/utils/billing/session", () => session)
import { startBillingSessionBridge } from "./billing-session-bridge"

const value = { sessionId: "secret", email: "a@example.com", displayName: null, signedInAt: 1 }
let stop: () => void

beforeEach(() => {
  session.getBillingSession.mockResolvedValue(value)
  session.setBillingSession.mockResolvedValue(value)
  session.clearBillingSession.mockResolvedValue(undefined)
  session.onBillingSessionChanged.mockReturnValue(vi.fn<() => void>())
  stop = startBillingSessionBridge()
})
afterEach(() => {
  stop()
  vi.clearAllMocks()
})

describe("billing session bridge", () => {
  it("returns the extension session to the support page", async () => {
    const response = new Promise<MessageEvent>((resolve) => {
      const listener = (event: MessageEvent) => {
        if (event.data?.source === "meowtabby-support-extension") {
          window.removeEventListener("message", listener)
          resolve(event)
        }
      }
      window.addEventListener("message", listener)
    })
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: window.location.origin,
        data: { source: "meowtabby-support-page", type: "get", requestId: "one" },
      }),
    )
    expect((await response).data.session).toEqual(value)
  })

  it("ignores a message from another window", async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: null,
        origin: window.location.origin,
        data: { source: "meowtabby-support-page", type: "clear", requestId: "two" },
      }),
    )
    await Promise.resolve()
    expect(session.clearBillingSession).not.toHaveBeenCalled()
  })

  it("rejects malformed sessions", async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: window.location.origin,
        data: {
          source: "meowtabby-support-page",
          type: "set",
          requestId: "three",
          session: { sessionId: 1 },
        },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(session.setBillingSession).not.toHaveBeenCalled()
  })

  it("does not respond after navigation outside the support path", async () => {
    window.history.pushState({}, "", "/meowtabby/privacy/")
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: window.location.origin,
        data: { source: "meowtabby-support-page", type: "get", requestId: "four" },
      }),
    )
    await Promise.resolve()
    expect(session.getBillingSession).not.toHaveBeenCalled()
    window.history.pushState({}, "", "/meowtabby/support/")
  })
})
