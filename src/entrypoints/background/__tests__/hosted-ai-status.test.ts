import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Backing store so getItem/setItem/removeItem round-trip like the real session
 * storage — the cache-hit case needs the written entry to be readable back.
 */
const { getItemMock, setItemMock, removeItemMock, watchMock, store } = vi.hoisted(() => {
  const entries = new Map<string, unknown>()
  return {
    getItemMock: vi.fn<(...args: any[]) => any>((key: string) =>
      Promise.resolve(entries.get(key) ?? null),
    ),
    setItemMock: vi.fn<(...args: any[]) => any>((key: string, value: unknown) => {
      entries.set(key, value)
      return Promise.resolve()
    }),
    removeItemMock: vi.fn<(...args: any[]) => any>((key: string) => {
      entries.delete(key)
      return Promise.resolve()
    }),
    watchMock: vi.fn<(...args: any[]) => any>().mockReturnValue(() => {}),
    store: entries,
  }
})

vi.mock("#imports", () => ({
  storage: {
    getItem: getItemMock,
    setItem: setItemMock,
    removeItem: removeItemMock,
    watch: watchMock,
  },
}))
vi.mock("wxt/utils/storage", () => ({
  storage: {
    getItem: getItemMock,
    setItem: setItemMock,
    removeItem: removeItemMock,
    watch: watchMock,
  },
}))

vi.mock("@/utils/message", () => ({ onMessage: vi.fn<(...args: any[]) => any>() }))

vi.mock("@/utils/billing/session", () => ({
  getBillingSession: vi.fn<(...args: any[]) => any>(),
  onBillingSessionChanged: vi.fn<(...args: any[]) => any>().mockReturnValue(() => {}),
}))
vi.mock("@/utils/billing/rest", () => ({
  billingMe: vi.fn<(...args: any[]) => any>(),
  BillingApiError: class BillingApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
      this.name = "BillingApiError"
    }
  },
}))

import { BillingApiError, billingMe } from "@/utils/billing/rest"
import { getBillingSession } from "@/utils/billing/session"
import { onMessage } from "@/utils/message"
import { clearHostedAiStatusCache, setupHostedAiStatusHandler } from "../hosted-ai-status"

type StatusHandler = () => Promise<unknown>
function lastRegisteredHandler(): StatusHandler {
  const calls = vi.mocked(onMessage).mock.calls
  const statusCall = calls.find((call) => call[0] === "getHostedAiStatus")
  return statusCall?.[1] as StatusHandler
}

const SESSION = { sessionId: "sess-1", email: "a@b.c", displayName: null, signedInAt: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  watchMock.mockReturnValue(() => {})
  setupHostedAiStatusHandler()
})

describe("getHostedAiStatus handler (billing source)", () => {
  it("reports unauthenticated without a session and skips /me", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    expect(await lastRegisteredHandler()()).toEqual({
      authenticated: false,
      balanceYuan: null,
      email: null,
    })
    expect(billingMe).not.toHaveBeenCalled()
  })

  it("reports authenticated with balance from /me and caches it", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(SESSION)
    vi.mocked(billingMe).mockResolvedValue({
      user_id: "u1",
      email: "a@b.c",
      display_name: null,
      email_verified: true,
      balance: "1.2345",
      total_recharged: "2.0000",
      total_spent: "0.7655",
      total_tokens: 10,
      recent_calls: [],
    })
    const handler = lastRegisteredHandler()
    expect(await handler()).toEqual({ authenticated: true, balanceYuan: "1.2345", email: "a@b.c" })
    // 第二次命中缓存，不再打 /me
    await handler()
    expect(billingMe).toHaveBeenCalledTimes(1)
  })

  it("fails open (null) on a network error", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(SESSION)
    vi.mocked(billingMe).mockRejectedValue(new Error("network"))
    expect(await lastRegisteredHandler()()).toBeNull()
  })

  it("maps a 401 from /me back to unauthenticated", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(SESSION)
    vi.mocked(billingMe).mockRejectedValue(new BillingApiError(401, "expired"))
    expect(await lastRegisteredHandler()()).toEqual({
      authenticated: false,
      balanceYuan: null,
      email: null,
    })
  })

  it("clears the cache on session change", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(SESSION)
    vi.mocked(billingMe).mockResolvedValue({
      user_id: "u1",
      email: "a@b.c",
      display_name: null,
      email_verified: true,
      balance: "1.0000",
      total_recharged: "1.0000",
      total_spent: "0.0000",
      total_tokens: 0,
      recent_calls: [],
    })
    await lastRegisteredHandler()()
    await clearHostedAiStatusCache()
    await lastRegisteredHandler()()
    expect(billingMe).toHaveBeenCalledTimes(2)
  })
})
