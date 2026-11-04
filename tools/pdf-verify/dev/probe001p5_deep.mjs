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
  const band = items.filter((it) => it.y > 560 && it.y < 600)
  console.log("=== band items (normalized) ===")
  for (const it of band) {
    console.log(
      `x=${it.x.toFixed(1)} y=${it.y.toFixed(1)} w=${it.w.toFixed(1)} h=${it.h.toFixed(2)} font=${it.fontName.slice(0, 20)} order=${it.order} :: ${JSON.stringify(it.str)}`,
    )
  }
  console.log("=== bodyH split ===")
  const lenByH = new Map()
  for (const it of band) lenByH.set(it.h, (lenByH.get(it.h) ?? 0) + it.str.length)
  let bodyH = 0,
    bestLen = -1
  for (const [h, len] of lenByH) {
    if (len > bestLen) {
      bodyH = h
      bestLen = len
    }
  }
  console.log("bodyH =", bodyH, "threshold =", bodyH * 0.8)
  const full = band.filter((it) => it.h >= bodyH * 0.8)
  const small = band.filter((it) => it.h < bodyH * 0.8)
  console.log("full count =", full.length, "small count =", small.length)
  console.log("=== small items (Pass 2 candidates) ===")
  for (const it of small) {
    console.log(
      `x=${it.x.toFixed(1)} y=${it.y.toFixed(1)} w=${it.w.toFixed(1)} h=${it.h.toFixed(2)} :: ${JSON.stringify(it.str)}`,
    )
  }
  console.log("=== buildLines output ===")
  const lines = buildLines(band)
  for (const ln of lines) {
    console.log(
      `y=${ln.y.toFixed(2)} h=${ln.h.toFixed(2)} x=${ln.x.toFixed(1)} w=${ln.w.toFixed(1)} items=${ln.items.length} :: ${JSON.stringify(ln.text)}`,
    )
    for (const it of ln.items) {
      console.log(
        `    item x=${it.x.toFixed(1)} y=${it.y.toFixed(1)} w=${it.w.toFixed(1)} h=${it.h.toFixed(2)} :: ${JSON.stringify(it.str)}`,
      )
    }
  }
  await pdf.destroy()
} finally {
  await server.close()
}
