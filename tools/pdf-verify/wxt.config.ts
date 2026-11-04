import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { defineConfig } from "wxt"

const projectRoot = path.resolve(__dirname, "../..")
const runtimeRoot = path.join(projectRoot, "public")
const modelFile = path.join(projectRoot, "model-store/doclayout_yolo.onnx")
const modelHash = existsSync(modelFile)
  ? createHash("sha256").update(readFileSync(modelFile)).digest("hex")
  : ""

// WXT 的 root 必须是 tools/pdf-verify：.wxt、入口发现和产物因此各自独立。
export default defineConfig({
  srcDir: "src",
  publicDir: "public",
  outDir: ".output",
  imports: false,
  manifestVersion: 3,
  manifest: {
    name: "MeowTabby PDF 版面验证器",
    description: "使用共用 D 核心验证 PDF 版面、阅读序及跨栏跨页同段组",
    version: "0.0.1",
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
  hooks: {
    "build:publicAssets": (_wxt, files) => {
      // 两种构建从同一份 public 读资源；验证器不复制维护 PDF.js/ORT 资源。
      const addTree = (relative: string) => {
        const absolute = path.join(runtimeRoot, relative)
        for (const entry of readdirSync(absolute, { withFileTypes: true })) {
          const name = path.join(relative, entry.name)
          if (entry.isDirectory()) addTree(name)
          else if (!entry.name.startsWith("."))
            files.push({ absoluteSrc: path.join(runtimeRoot, name), relativeDest: name })
        }
      }
      for (const name of ["cmaps", "standard_fonts"]) addTree(name)
      for (const name of readdirSync(runtimeRoot))
        if (name === "pdf.worker.min.mjs" || /^ort-wasm-.*\.(?:wasm|mjs)$/.test(name))
          files.push({ absoluteSrc: path.join(runtimeRoot, name), relativeDest: name })
      const model = path.join(projectRoot, "model-store/doclayout_yolo.onnx")
      if (!existsSync(model))
        throw new Error(
          "请先把 doclayout_yolo.onnx 放到 MeowTabby/model-store/，验证器需要本地模型。",
        )
      files.push({ absoluteSrc: model, relativeDest: "doclayout_yolo.onnx" })
    },
  },
  vite: () => ({
    define: {
      "import.meta.env.WXT_BUNDLE_MODEL": "true",
      "import.meta.env.PDF_VERIFY_MODEL_SHA256": JSON.stringify(modelHash),
    },
  }),
})
