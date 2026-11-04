import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { describe, expect, it } from "vitest"
import { blockDisplayTransform } from "../pdf/coords-rot"
import { analyzePage } from "../pipeline"

// 使用PDF.js实际视口矩阵，避免把旧坐标公式复制成测试期望。
describe("旋转页文字坐标与PDF.js显示坐标一致", () => {
  for (const rotate of [0, 90, 180, 270]) {
    it(`${rotate}度反变换和原位回填都与真实视口一致`, async () => {
      const source = `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Rotate ${rotate} /Resources << >> >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF`
      const task = getDocument({ data: new TextEncoder().encode(source) })
      try {
        const doc = await task.promise
        const page = await doc.getPage(1)
        const vp = page.getViewport({ scale: 1 })
        const r = vp.convertToViewportRectangle([20, 180, 100, 220])
        const expected = [
          Math.min(r[0], r[2]),
          Math.min(r[1], r[3]),
          Math.max(r[0], r[2]),
          Math.max(r[1], r[3]),
        ]
        const analysis = analyzePage({
          index: 1,
          cssW: vp.width,
          cssH: vp.height,
          rotate,
          items: [],
          regions: [
            {
              x1: expected[0]!,
              y1: expected[1]!,
              x2: expected[2]!,
              y2: expected[3]!,
              behavior: "keep",
              className: "figure",
              conf: 0.9,
            },
          ],
        })
        const region = analysis.regionsUp[0]!
        expect([region.x1, region.y1, region.x2, region.y2]).toEqual([20, 180, 100, 220])
        const display =
          rotate === 0
            ? { left: 20, top: 80, rotateDeg: 0 }
            : blockDisplayTransform(
                { x: 20, y: 180, w: 80, h: 40 },
                analysis.pageWu,
                analysis.pageHu,
                rotate,
              )
        const degrees = (display.rotateDeg * Math.PI) / 180
        const points = [
          [0, 0],
          [80, 0],
          [0, 40],
          [80, 40],
        ].map(([x, y]) => [
          display.left + x! * Math.cos(degrees) - y! * Math.sin(degrees),
          display.top + x! * Math.sin(degrees) + y! * Math.cos(degrees),
        ])
        const bounds = [
          Math.min(...points.map((p) => p[0]!)),
          Math.min(...points.map((p) => p[1]!)),
          Math.max(...points.map((p) => p[0]!)),
          Math.max(...points.map((p) => p[1]!)),
        ]
        bounds.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 8))
      } finally {
        await task.destroy()
      }
    })
  }
})
