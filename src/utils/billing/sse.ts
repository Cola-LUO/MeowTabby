// src/utils/billing/sse.ts

export interface BillingSseEvent {
  event: string
  data: string
}

/**
 * 增量 SSE 解析：任意字节边界（含多字节字符切半）安全。
 * 注释行（`:` 开头，后端 15s 心跳）忽略；空行分发一帧；
 * 未以空行收尾的残帧在流末尾兜底分发（后端恒以 \n\n 收尾，此为防御）。
 */
export async function* readBillingSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<BillingSseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let eventName = ""
  let dataLines: string[] = []

  function* drainBuffer(flush: boolean): Generator<BillingSseEvent> {
    let newlineIndex = buffer.indexOf("\n")
    while (newlineIndex !== -1) {
      const rawLine = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
      if (line === "") {
        if (dataLines.length > 0) {
          yield { event: eventName || "message", data: dataLines.join("\n") }
        }
        eventName = ""
        dataLines = []
      } else if (!line.startsWith(":")) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).replace(/^ /, "")
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).replace(/^ /, ""))
        }
      }
      newlineIndex = buffer.indexOf("\n")
    }
    if (flush && dataLines.length > 0) {
      yield { event: eventName || "message", data: dataLines.join("\n") }
      eventName = ""
      dataLines = []
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      yield* drainBuffer(false)
    }
    buffer += decoder.decode()
    yield* drainBuffer(true)
  } finally {
    reader.releaseLock()
  }
}
