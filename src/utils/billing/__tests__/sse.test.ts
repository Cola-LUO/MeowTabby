// src/utils/billing/__tests__/sse.test.ts
import { describe, expect, it } from "vitest"
import { readBillingSseEvents } from "../sse"

function streamFromRawChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const events = []
  for await (const event of readBillingSseEvents(stream)) events.push(event)
  return events
}

describe("readBillingSseEvents", () => {
  it("parses delta and done events", async () => {
    const stream = streamFromRawChunks([
      'event: delta\ndata: {"text":"Hello"}\n\n',
      'event: done\ndata: {"cost":"0.00000300"}\n\n',
    ])
    expect(await collect(stream)).toEqual([
      { event: "delta", data: '{"text":"Hello"}' },
      { event: "done", data: '{"cost":"0.00000300"}' },
    ])
  })

  it("ignores heartbeat comments", async () => {
    const stream = streamFromRawChunks([": keep-alive\n\n", "event: done\ndata: {}\n\n"])
    expect(await collect(stream)).toEqual([{ event: "done", data: "{}" }])
  })

  it("handles chunk boundaries inside a line", async () => {
    const stream = streamFromRawChunks(["event: del", 'ta\ndata: {"te', 'xt":"x"}\n\n'])
    expect(await collect(stream)).toEqual([{ event: "delta", data: '{"text":"x"}' }])
  })

  it("handles a multibyte character split across chunks", async () => {
    const encoded = new TextEncoder().encode('data: {"text":"译"}\n\n')
    const splitAt = encoded.indexOf(0xe8) // UTF-8 首字节处切开
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, splitAt))
        controller.enqueue(encoded.slice(splitAt))
        controller.close()
      },
    })
    expect(await collect(stream)).toEqual([{ event: "message", data: '{"text":"译"}' }])
  })

  it("joins multiline data fields with newlines", async () => {
    const stream = streamFromRawChunks(["data: line1\ndata: line2\n\n"])
    expect(await collect(stream)).toEqual([{ event: "message", data: "line1\nline2" }])
  })

  it("supports CRLF line endings", async () => {
    const stream = streamFromRawChunks(["event: done\r\ndata: {}\r\n\r\n"])
    expect(await collect(stream)).toEqual([{ event: "done", data: "{}" }])
  })

  it("resets event name after dispatch", async () => {
    const stream = streamFromRawChunks(["event: delta\ndata: a\n\ndata: b\n\n"])
    expect(await collect(stream)).toEqual([
      { event: "delta", data: "a" },
      { event: "message", data: "b" },
    ])
  })
})
