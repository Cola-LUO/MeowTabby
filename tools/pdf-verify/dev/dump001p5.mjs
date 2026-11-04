import { readFile } from "node:fs/promises"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
const pdfPath =
  "/Users/Luo_F/vs_code_2（其他项目）/测试资源（音频、图片）/测试PDF/001_Attention Is All You Need.pdf"
const data = await readFile(pdfPath)
const pdf = await getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise
const page = await pdf.getPage(5)
const vp = page.getViewport({ scale: 1 })
const tc = await page.getTextContent()
const items = tc.items.filter((it) => it.str && it.str.trim() !== "")
console.log("viewport", vp.width, vp.height, "items", items.length)
for (let i = 0; i < items.length; i++) {
  const it = items[i]
  const x = it.transform[4],
    y = it.transform[5]
  const fontSize = Math.hypot(it.transform[0], it.transform[1])
  console.log(
    `${i} x=${x.toFixed(1)} y=${y.toFixed(1)} fs=${fontSize.toFixed(1)} :: ${JSON.stringify(it.str)}`,
  )
}
await pdf.destroy()
