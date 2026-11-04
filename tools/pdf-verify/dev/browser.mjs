// Chrome 已用 --remote-debugging-port 启动并载入本工具后，按页面 URL 发现扩展 ID。
import { writeFile } from "node:fs/promises"
import path from "node:path"

const [pdf, output] = process.argv.slice(2)
if (!pdf)
  throw new Error(
    "用法：node tools/pdf-verify/dev/browser.mjs <PDF> [输出.jsonl]；CDP_PORT 默认 9223",
  )
const origin = `http://127.0.0.1:${process.env.CDP_PORT ?? 9223}`
const targets = await (await fetch(`${origin}/json/list`)).json()
const target = targets.find((page) =>
  /^chrome-extension:\/\/[^/]+\/pdf-verify\.html/.test(page.url),
)
if (!target)
  throw new Error("请先在已载入 MeowTabby/tools/pdf-verify/.output/chrome-mv3 的浏览器中打开验证页")
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true })
  socket.addEventListener("error", reject, { once: true })
})
let id = 0
const pending = new Map()
const logs = []
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data)
  if (message.id) {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  } else if (message.method === "Runtime.consoleAPICalled") {
    const line = message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")
    logs.push(line)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const request = ++id
    pending.set(request, { resolve, reject })
    socket.send(JSON.stringify({ id: request, method, params }))
  })
const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}
try {
  await send("Runtime.enable")
  await send("DOM.enable")
  const { root } = await send("DOM.getDocument")
  const { nodeId } = await send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[type="file"]',
  })
  if (!nodeId) throw new Error("请先点击重新选择 PDF，显示文件选择器")
  await send("DOM.setFileInputFiles", { nodeId, files: [path.resolve(pdf)] })
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    const status = await evaluate('document.querySelector(".toolbar-status")?.textContent ?? ""')
    if (/完成：|处理失败/.test(status)) {
      if (output) await writeFile(output, logs.join("\n") + "\n")
      console.log(status)
      if (/处理失败/.test(status)) process.exitCode = 1
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (Date.now() >= deadline) throw new Error("验证超时")
} finally {
  socket.close()
}
