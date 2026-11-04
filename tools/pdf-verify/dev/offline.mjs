// 直接调用产品/验证器共用入口，不维护第二条后处理流程。
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { createServer } from "vite"

const [pdfPath, sliceDirectory, output] = process.argv.slice(2)
if (!pdfPath || !sliceDirectory)
  throw new Error("用法：node tools/pdf-verify/dev/offline.mjs <PDF> <slices目录> [输出.json]")
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url))
const server = await createServer({
  root: projectRoot,
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
})
try {
  const { analyzePage } = await server.ssrLoadModule("/src/modules/pdf-core/pipeline.ts")
  const { createDocumentFlow } = await server.ssrLoadModule(
    "/src/modules/pdf-core/document-flow.ts",
  )
  const { normalizeItems } = await server.ssrLoadModule("/src/modules/pdf-core/pdf/text-items.ts")
  const { sliceMatchesModel } = await server.ssrLoadModule("/tools/pdf-verify/src/slice-format.ts")
  const modelHash = createHash("sha256")
    .update(await readFile(path.join(projectRoot, "model-store/doclayout_yolo.onnx")))
    .digest("hex")
  const data = await readFile(pdfPath)
  const key = `1:${createHash("sha256").update(data).digest("hex")}`
  const pdf = await getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    cMapUrl: path.join(projectRoot, "public/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: path.join(projectRoot, "public/standard_fonts/"),
  }).promise
  const flow = createDocumentFlow()
  const pages = []
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index)
    const viewport = page.getViewport({ scale: 1 })
    const slice = JSON.parse(
      await readFile(
        path.join(sliceDirectory, `v${key.replace(":", "-")}`, `page-${index}.json`),
        "utf8",
      ),
    )
    if (
      slice.key !== `${key}:${index}` ||
      slice.cssW !== viewport.width ||
      slice.cssH !== viewport.height ||
      !sliceMatchesModel(slice, modelHash)
    )
      throw new Error(`第 ${index} 页切片与 PDF 不匹配`)
    const text = await page.getTextContent()
    const analysis = analyzePage({
      index,
      cssW: viewport.width,
      cssH: viewport.height,
      rotate: page.rotate,
      items: normalizeItems(text.items, text.styles, page.view),
      regions: slice.regions,
    })
    const update = flow.push(analysis)
    pages.push({
      index,
      blocks: analysis.blocks,
      order: analysis.order.seq.map((block) => analysis.blocks.indexOf(block)),
      placed: analysis.order.placed,
      total: analysis.order.total,
      pending: update.pending.map((part) => part.id),
    })
  }
  const final = flow.finish()
  const result = {
    pdf: path.basename(pdfPath),
    pages,
    groups: final.groups.map((group) => ({
      parts: group.parts.map((part) => part.id),
      decisions: group.decisions,
    })),
    decisions: final.decisions,
  }
  const serialized = JSON.stringify(result, null, 2)
  if (output) await writeFile(output, serialized + "\n")
  else process.stdout.write(serialized + "\n")
  await pdf.destroy()
} finally {
  await server.close()
}
