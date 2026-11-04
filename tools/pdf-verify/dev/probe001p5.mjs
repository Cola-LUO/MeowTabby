import { readFile } from "node:fs/promises"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { createServer } from "vite"

const projectRoot = new URL("../../../", import.meta.url).pathname
const server = await createServer({
  root: projectRoot,
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
})
const pdfPath =
  "/Users/Luo_F/vs_code_2（其他项目）/测试资源（音频、图片）/测试PDF/001_Attention Is All You Need.pdf"
try {
  const { normalizeItems } = await server.ssrLoadModule("/src/modules/pdf-core/pdf/text-items.ts")
  const { buildLines } = await server.ssrLoadModule("/src/modules/pdf-core/assign/assign.ts")
  const data = await readFile(pdfPath)
  const pdf = await getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise
  const page = await pdf.getPage(5)
  const tc = await page.getTextContent()
  const items = normalizeItems(tc.items, tc.styles, page.view)
  // 只看 y-up 坐标里 560~600 区间（即那几行公式）
  const band = items.filter((it) => it.y > 560 && it.y < 600)
  const lines = buildLines(band)
  console.log("=== buildLines 输出（按 y 降序）===")
  for (const ln of lines) {
    console.log(
      `y=${ln.y.toFixed(2)} h=${ln.h.toFixed(2)} x=${ln.x.toFixed(1)} w=${ln.w.toFixed(1)} items=${ln.items.length} :: ${JSON.stringify(ln.text)}`,
    )
  }
  await pdf.destroy()
} finally {
  await server.close()
}
