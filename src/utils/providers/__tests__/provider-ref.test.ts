import type { SystemProviderRef } from "../provider-registry"
import type { BillingHostedStatus } from "@/utils/billing/types"
import { beforeEach, describe, expect, it, vi } from "vitest"

// The background owns the request and its cache; content only asks for it.
const hostedAiStatus = vi.fn<(...args: unknown[]) => Promise<unknown>>()

vi.mock("@/utils/message", () => ({
  sendMessage: (...args: unknown[]) => hostedAiStatus(...args),
}))

const { HostedAiProviderUnavailableError, serializeProviderRef } = await import("../provider-ref")

const SYSTEM_PROVIDER: SystemProviderRef = {
  kind: "system",
  id: "read-frog-free-ai",
  name: "Built-in AI",
  modelTier: "normal",
}

const SIGNED_IN: BillingHostedStatus = {
  authenticated: true,
  balanceYuan: "1.0000",
  email: "a@b.c",
}
const SIGNED_OUT: BillingHostedStatus = { authenticated: false, balanceYuan: null, email: null }

/** A promise whose settlement the test controls, so overlap is deterministic. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("serializeProviderRef billing gate", () => {
  beforeEach(() => {
    hostedAiStatus.mockReset()
  })

  it("throws unavailable when signed out", async () => {
    hostedAiStatus.mockResolvedValue(SIGNED_OUT)
    await expect(serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation")).rejects.toBeInstanceOf(
      HostedAiProviderUnavailableError,
    )
  })

  it("serializes with the billing model revision when signed in", async () => {
    hostedAiStatus.mockResolvedValue(SIGNED_IN)
    await expect(serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation")).resolves.toEqual({
      kind: "system",
      providerId: SYSTEM_PROVIDER.id,
      modelTier: SYSTEM_PROVIDER.modelTier,
      modelRevision: "billing-v1",
    })
  })

  it("fails open when the status ask errors or times out", async () => {
    hostedAiStatus.mockResolvedValue(null)
    await expect(serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation")).resolves.toMatchObject({
      kind: "system",
      modelRevision: "billing-v1",
    })
  })

  it("never reaches the status endpoint for a local provider", async () => {
    const local = { provider: "openai", id: "openai-1" } as never

    await expect(serializeProviderRef(local, "pageTranslation")).resolves.toEqual({
      kind: "local",
      config: local,
    })
    expect(hostedAiStatus).not.toHaveBeenCalled()
  })
})

describe("serializeProviderRef status coalescing", () => {
  beforeEach(() => {
    hostedAiStatus.mockReset()
  })

  it("asks the background once for callers that overlap, and gives each the same verdict", async () => {
    const gate = deferred<BillingHostedStatus>()
    hostedAiStatus.mockReturnValue(gate.promise)

    // Two features and two routes that collapse onto one: nothing about the
    // caller should split the shared request, since one response covers all.
    const refs = Promise.all([
      serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation"),
      serializeProviderRef(SYSTEM_PROVIDER, "videoSubtitles"),
      serializeProviderRef(SYSTEM_PROVIDER, "videoSubtitlesSegmentation"),
    ])

    expect(hostedAiStatus).toHaveBeenCalledTimes(1)

    gate.resolve(SIGNED_IN)
    const [page, subtitles, segmentation] = await refs

    expect(hostedAiStatus).toHaveBeenCalledTimes(1)
    for (const ref of [page, subtitles, segmentation]) {
      expect(ref).toEqual({
        kind: "system",
        providerId: "read-frog-free-ai",
        modelTier: "normal",
        modelRevision: "billing-v1",
      })
    }
  })

  it("refetches once the shared request settles, so a sign-out mid-page is seen", async () => {
    hostedAiStatus.mockResolvedValueOnce(SIGNED_IN)
    await serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation")

    // The next caller does not overlap the first, so it must get a fresh
    // verdict rather than a retained one — this is coalescing, not caching.
    hostedAiStatus.mockResolvedValueOnce(SIGNED_OUT)
    await expect(serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation")).rejects.toBeInstanceOf(
      HostedAiProviderUnavailableError,
    )

    expect(hostedAiStatus).toHaveBeenCalledTimes(2)
  })

  it("rejects every overlapping caller on an explicit signed-out verdict", async () => {
    const gate = deferred<BillingHostedStatus>()
    hostedAiStatus.mockReturnValue(gate.promise)

    const results = Promise.allSettled([
      serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation"),
      serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation"),
    ])

    gate.resolve(SIGNED_OUT)

    for (const result of await results) {
      expect(result.status).toBe("rejected")
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(
        HostedAiProviderUnavailableError,
      )
    }
    expect(hostedAiStatus).toHaveBeenCalledTimes(1)
  })

  it("fails open for every overlapping caller when the background has no verdict", async () => {
    // The background catches its own fetch failure and answers null; content
    // must treat that the same as "no verdict", not as a denial.
    const gate = deferred<BillingHostedStatus | null>()
    hostedAiStatus.mockReturnValue(gate.promise)

    const refs = Promise.all([
      serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation"),
      serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation"),
    ])

    gate.resolve(null)

    // No verdict means no block: the generation endpoints enforce access.
    for (const ref of await refs) {
      expect(ref).toMatchObject({ kind: "system", modelRevision: "billing-v1" })
    }

    // The empty answer must not be retained either, or one outage would pin
    // every later call to the fail-open path.
    hostedAiStatus.mockResolvedValueOnce(SIGNED_IN)
    await expect(serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation")).resolves.toMatchObject({
      modelRevision: "billing-v1",
    })
    expect(hostedAiStatus).toHaveBeenCalledTimes(2)
  })

  it("fails open when the message itself cannot be delivered", async () => {
    hostedAiStatus.mockRejectedValueOnce(new Error("no receiving end"))

    await expect(serializeProviderRef(SYSTEM_PROVIDER, "pageTranslation")).resolves.toMatchObject({
      kind: "system",
      modelRevision: "billing-v1",
    })
  })
})
