// src/utils/billing/__tests__/session.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const { getItemMock, setItemMock, removeItemMock, watchMock } = vi.hoisted(() => ({
  getItemMock: vi.fn<(...args: any[]) => any>(),
  setItemMock: vi.fn<(...args: any[]) => any>(),
  removeItemMock: vi.fn<(...args: any[]) => any>(),
  watchMock: vi.fn<(...args: any[]) => any>().mockReturnValue(() => {}),
}))

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

import {
  BILLING_SESSION_STORAGE_KEY,
  clearBillingSession,
  getBillingSession,
  onBillingSessionChanged,
  setBillingSession,
} from "../session"

const FULL_KEY = `local:${BILLING_SESSION_STORAGE_KEY}`

beforeEach(() => {
  vi.clearAllMocks()
  watchMock.mockReturnValue(() => {})
})

describe("getBillingSession", () => {
  it("returns null when nothing is stored", async () => {
    getItemMock.mockResolvedValue(null)
    expect(await getBillingSession()).toBeNull()
    expect(getItemMock).toHaveBeenCalledWith(FULL_KEY)
  })

  it("returns the stored session", async () => {
    const session = { sessionId: "s1", email: "a@b.c", displayName: null, signedInAt: 1 }
    getItemMock.mockResolvedValue(session)
    expect(await getBillingSession()).toEqual(session)
  })

  it("returns null for a malformed entry", async () => {
    getItemMock.mockResolvedValue({ email: "a@b.c" })
    expect(await getBillingSession()).toBeNull()
  })

  it("returns null when storage throws", async () => {
    getItemMock.mockRejectedValue(new Error("boom"))
    expect(await getBillingSession()).toBeNull()
  })
})

describe("setBillingSession", () => {
  it("stores the session with a fresh signedInAt", async () => {
    const stored = await setBillingSession({ sessionId: "s1", email: "a@b.c", displayName: "N" })
    expect(stored.sessionId).toBe("s1")
    expect(typeof stored.signedInAt).toBe("number")
    expect(setItemMock).toHaveBeenCalledWith(FULL_KEY, stored)
  })
})

describe("clearBillingSession", () => {
  it("removes the storage key", async () => {
    await clearBillingSession()
    expect(removeItemMock).toHaveBeenCalledWith(FULL_KEY)
  })
})

describe("onBillingSessionChanged", () => {
  it("forwards storage.watch values and returns an unwatch", () => {
    const callback = vi.fn<(...args: any[]) => any>()
    const unwatch = vi.fn<(...args: any[]) => any>()
    watchMock.mockReturnValue(unwatch)
    const dispose = onBillingSessionChanged(callback)
    expect(watchMock).toHaveBeenCalledWith(FULL_KEY, expect.any(Function))
    const [, registered] = watchMock.mock.calls[0]!
    registered({ sessionId: "s2" })
    registered(undefined)
    expect(callback).toHaveBeenNthCalledWith(1, { sessionId: "s2" })
    expect(callback).toHaveBeenNthCalledWith(2, null)
    dispose()
    expect(unwatch).toHaveBeenCalled()
  })
})
