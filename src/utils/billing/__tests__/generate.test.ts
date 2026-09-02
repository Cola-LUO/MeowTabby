// src/utils/billing/__tests__/generate.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getRequestErrorMeta } from "@/utils/request/retry-policy"

vi.mock("@/env", () => ({
  env: { WXT_BILLING_API_URL: "https://billing.test" },
}))

import { createBillingTextPartStream } from "../generate"
import { clearBillingSession, getBillingSession } from "../session"

vi.mock("../session", () => ({
  getBillingSession: vi.fn<(...args: any[]) => any>(),
  clearBillingSession: vi.fn<(...args: any[]) => any>().mockResolvedValue(undefined),
}))

const fetchMock = vi.fn<(...args: any[]) => any>()

function sseResponse(sseText: string, status = 200) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseText))
      controller.close()
    },
  })
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    body: stream,
    json: vi.fn<(...args: any[]) => any>().mockResolvedValue({ detail: "" }),
  }
}

const INPUT = {
  systemPrompt: "sys",
  prompt: "hello",
  requestId: "rid-1",
  feature: "pageTranslation" as const,
}

async function collect(iterable: AsyncIterable<Record<string, unknown>>) {
  const parts = []
  for await (const part of iterable) parts.push(part)
  return parts
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.mocked(getBillingSession).mockReset()
  vi.mocked(clearBillingSession).mockClear()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createBillingTextPartStream", () => {
  it("throws an access-denied 401 when no session is stored", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    await expect(createBillingTextPartStream(INPUT)).rejects.toSatisfy((error: unknown) => {
      const meta = getRequestErrorMeta(error)
      return meta.statusCode === 401 && meta.kind === "access-denied"
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("posts the contract body and bearer token", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    fetchMock.mockResolvedValue(sseResponse("event: done\ndata: {}\n\n"))
    await collect(await createBillingTextPartStream({ ...INPUT, maxOutputTokens: 1024 }))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://billing.test/v1/generate")
    expect(init.headers.Authorization).toBe("Bearer sess-1")
    expect(JSON.parse(init.body)).toEqual({
      request_id: "rid-1",
      feature: "pageTranslation",
      system_prompt: "sys",
      prompt: "hello",
      max_output_tokens: 1024,
    })
  })

  it("yields text-delta parts then finish", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    fetchMock.mockResolvedValue(
      sseResponse(
        'event: delta\ndata: {"text":"你好"}\n\nevent: delta\ndata: {"text":"，世界"}\n\nevent: done\ndata: {"cost":"0.00000300"}\n\n',
      ),
    )
    const parts = await collect(await createBillingTextPartStream(INPUT))
    expect(parts).toEqual([
      { type: "text-delta", text: "你好" },
      { type: "text-delta", text: "，世界" },
      { type: "finish", finishReason: "stop" },
    ])
  })

  it("classifies a 402 before the stream as access-denied", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      statusText: "Payment Required",
      body: null,
      json: vi.fn<(...args: any[]) => any>().mockResolvedValue({ detail: "余额不足" }),
    })
    await expect(createBillingTextPartStream(INPUT)).rejects.toSatisfy((error: unknown) => {
      const meta = getRequestErrorMeta(error)
      if (meta.statusCode !== 402 || meta.kind !== "access-denied") {
        return false
      }
      // Fixed guidance copy wins over the backend detail ("余额不足"); the
      // mocked i18n facade resolves keys to themselves.
      return (error as Error).message === "billing.errors.balanceInsufficient"
    })
  })

  it("clears the session on a 401 before the stream", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      body: null,
      json: vi.fn<(...args: any[]) => any>().mockResolvedValue({ detail: "会话已过期" }),
    })
    await expect(createBillingTextPartStream(INPUT)).rejects.toMatchObject({ status: 401 })
    expect(clearBillingSession).toHaveBeenCalled()
  })

  it("throws on an in-stream error event", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    fetchMock.mockResolvedValue(
      sseResponse(
        'event: delta\ndata: {"text":"半"}\n\nevent: error\ndata: {"detail":"上游调用失败"}\n\n',
      ),
    )
    const iterable = await createBillingTextPartStream(INPUT)
    await expect(collect(iterable)).rejects.toThrow("上游调用失败")
  })

  it("fires /v1/cancel when the signal aborts", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    // 永不结束的流：挂起的 read 让 abort 成为唯一的退出路径
    let cancelRead: (() => void) | undefined
    const hanging = new ReadableStream<Uint8Array>({
      start(controller) {
        cancelRead = () => controller.close()
      },
    })
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/v1/cancel")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({ message: "ok" }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, statusText: "OK", body: hanging })
    })
    const controller = new AbortController()
    const iterable = await createBillingTextPartStream(INPUT, controller.signal)
    const reader = (async () => {
      try {
        for await (const _ of iterable) {
          /* drain */
        }
      } catch {
        /* abort 预期抛错 */
      }
    })()
    controller.abort()
    await vi.waitFor(() => {
      const cancelCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/v1/cancel"))
      expect(cancelCalls).toHaveLength(1)
      expect(JSON.parse(cancelCalls[0]![1].body)).toEqual({ request_id: "rid-1" })
    })
    cancelRead?.()
    await reader
  })
})
