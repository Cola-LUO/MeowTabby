import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const walk = (dir, prefix = "") =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name
    return entry.isDirectory() ? walk(path.join(dir, entry.name), name + "/") : [name]
  })
const forbidden =
  /(?:^|\/)(?:pdf-verify(?:\.[^/]+)?|slices|archive|fixtures|dev|tools|model-store)(?:\/|$)/
const product = path.resolve(root, process.argv[2] ?? ".output/chrome-mv3")
const verifier = path.join(root, "tools/pdf-verify/.output/chrome-mv3")
assert(existsSync(path.join(product, "manifest.json")), `请先构建正式扩展：${product}`)
const productFiles = walk(product)
assert.deepEqual(
  productFiles.filter((file) => forbidden.test(file)),
  [],
  "正式安装目录包含验证器资料",
)
if (process.env.WXT_BUNDLE_MODEL !== "true")
  assert(!productFiles.some((file) => file.endsWith(".onnx")), "默认正式构建残留模型")
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
if (existsSync(verifier)) {
  assert(existsSync(path.join(verifier, "pdf-verify.html")), "验证器页面缺失")
  assert.equal(
    hash(path.join(verifier, "doclayout_yolo.onnx")),
    hash(path.join(root, "model-store/doclayout_yolo.onnx")),
    "验证器模型不同源",
  )
  assert(!existsSync(path.join(verifier, "pdf-translate.html")), "验证器发现了正式产品入口")
  const runtimeFiles = walk(path.join(root, "public")).filter((file) =>
    /^(?:cmaps\/|standard_fonts\/|pdf\.worker\.min\.mjs$|ort-wasm-.*\.(?:wasm|mjs)$)/.test(file),
  )
  for (const file of runtimeFiles) {
    assert.equal(
      hash(path.join(verifier, file)),
      hash(path.join(root, "public", file)),
      `验证器资源不同源：${file}`,
    )
    assert.equal(
      hash(path.join(product, file)),
      hash(path.join(root, "public", file)),
      `正式资源不同源：${file}`,
    )
  }
}
const productSource = walk(path.join(root, "src"))
for (const file of productSource.filter((sourceName) => /\.[cm]?[jt]sx?$/.test(sourceName)))
  assert(
    !/(?:from\s*|import\s*\()\s*["'][^"']*tools\/pdf-verify/.test(
      readFileSync(path.join(root, "src", file), "utf8"),
    ),
    `正式源码导入了内部工具：${file}`,
  )
for (const dir of [path.join(root, ".output"), path.join(root, "tools/pdf-verify/.output")]) {
  if (!existsSync(dir)) continue
  for (const name of readdirSync(dir).filter((entryName) => entryName.endsWith(".zip"))) {
    const files = execFileSync("unzip", ["-Z1", path.join(dir, name)], { encoding: "utf8" })
      .trim()
      .split("\n")
    if (!name.includes("sources") && dir.includes("tools/pdf-verify")) continue
    assert.deepEqual(
      files.filter((file) => forbidden.test(file)),
      [],
      `压缩包包含内部工具：${name}`,
    )
    if (!name.includes("sources") && process.env.WXT_BUNDLE_MODEL !== "true")
      assert(!files.some((file) => file.endsWith(".onnx")), `默认压缩包残留模型：${name}`)
  }
}
console.log(
  `PDF 打包隔离通过：${productFiles.length} 个正式文件，运行资源与模型来源一致，已检查现有 ZIP。`,
)
