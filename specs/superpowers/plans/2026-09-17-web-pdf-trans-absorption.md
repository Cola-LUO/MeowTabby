# web_pdf_trans 合拢 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/Users/Luo_F/vs_code/web_pdf_trans`（DocLayout-YOLO 版面识别 + PDF 对照翻译 viewer）合拢进 MeowTabby，入口为 popup 图标 + 设置页 + 模型选择页新分组，翻译统一走 MeowTabby 通道（计费标签 `web-pdf-trans`）。

**Architecture:** 追加式移植。web_pdf_trans 的 `src/modules/**`（pdf/layout/assign/viewer/translate）逐字搬进新入口 `src/entrypoints/pdf-translate/modules/`，仅改 import 路径；唯一的接缝是 main.ts L203 的 `translate` 回调——从直连 LLM 换成 `sendMessage("translatePdfRequest")` 走 background 的 billing 队列。模型（72MB ONNX）运行时从 hf.co 下载 + Cache API 缓存，不打包。billing-backend 零代码改动（feature 为自由字符串，main.py L1036-1042 已验证）。

**Tech Stack:** WXT + pdfjs-dist 4.10.38 + onnxruntime-web 1.20.1（webgpu→wasm 回退）+ vitest；MeowTabby 既有 React 19 / Tailwind / webext-core messaging。

**Spec:** `/Users/Luo_F/vs_code/合拢计划.md`（6 条需求 + 第 7–15 条补充项 + 顶部裁决；执行时两份都要读）

## Global Constraints

- **计费标签逐字用 `web-pdf-trans`**（合拢计划第 5 条与顶部裁决；不是 absorption 的 `pdfTranslation`）
- **配置层 FeatureKey 用 `pdfTranslation`**（camelCase，与 `pageTranslation` 一致；只是配置命名，与计费标签是两回事）
- **模型运行时下载 + Cache API 缓存**（用户 2026-09-17 决定），模型文件不打进扩展
- **禁止携带**：`llm_trans.ts` 的硬编码 baseUrl/apiKey/model、URL 参数 `llm_trans_url/llm_trans_key/llm_trans_model`、`microsoft.ts` 备用通道
- **引擎零改动**：`src/modules/**` 逐字搬运，只改 import 路径，不重构、不格式化
- **不基于** `archive/pdf-viewer-absorption` 分支的任何实现（该分支是已放弃的启发式方案）
- commit message 用中文，conventional 前缀（仓库 husky 强制），如 `feat(pdf): 新增 xxx`
- 测试命令一律 `SKIP_FREE_API=true pnpm vitest run <path>`（跳过真实打免费 API 的集成用例）
- 构建命令 `WXT_SKIP_ENV_VALIDATION=true pnpm build`
- i18n：en.yml / zh-CN.yml 给精确文案，其余 7 个语言文件先放英文兜底（后续再润色）
- 权限核对结论（Task 9 复查）：MeowTabby `host_permissions: ["*://*/*"]` 已覆盖远程 PDF 拉取，本地 PDF 走文件选择器 + blob URL，**manifest 无需改**

**源码来源（下文以 `SRC` 指代）:** `/Users/Luo_F/vs_code/web_pdf_trans`

---

### Task 1: 开分支 + 计划文档入库

**Files:**

- Create: `specs/superpowers/plans/2026-09-17-web-pdf-trans-absorption.md`（本文件，从工作区复制）

**Interfaces:**

- Produces: 分支 `feat/web-pdf-trans`，基于 `fb3bec920f17892c858af309857f6e70bb48c82f`，后续所有任务在此分支上进行

- [ ] **Step 1: 建隔离工作区**

按 `superpowers:using-git-worktrees` 流程，在 `/Users/Luo_F/vs_code/MeowTabby` 上建 worktree，base 显式指定 `fb3bec920f17892c858af309857f6e70bb48c82f`（main 的发布点，**不要**从当前工作分支 `chore-设置-自定义页默认空白-词典逻辑待理清` 切，它落后于 main），分支名 `feat/web-pdf-trans`。

- [ ] **Step 2: 验证基点**

Run: `git log --oneline -1`
Expected: `fb3bec9 feat: 更新内置AI收费说明并发布正式版`

- [ ] **Step 3: 计划文档入库**

把本文件复制进 worktree 的 `specs/superpowers/plans/2026-09-17-web-pdf-trans-absorption.md`（若工作区已有未跟踪副本则移动过来）。

- [ ] **Step 4: Commit**

```bash
git add specs/superpowers/plans/2026-09-17-web-pdf-trans-absorption.md
git commit -m "docs(pdf): 添加 web_pdf_trans 合拢实施计划"
```

---

### Task 2: 类型、配置与 i18n 地基

**Files:**

- Modify: `src/utils/billing/types.ts:3-13`（BillingFeature）
- Modify: `src/types/background-stream.ts:43-52`（HostedAiTextStreamRoute）
- Modify: `src/utils/constants/feature-providers.ts`（FEATURE_KEYS / FEATURE_PROVIDER_DEFS / FEATURE_KEY_I18N_MAP）
- Modify: `src/types/config/config.ts:119-137`（configSchema）与 `src/utils/constants/config.ts:52`（CONFIG_SCHEMA_VERSION）
- Create: `src/utils/config/migration-scripts/v099-to-v100.ts`
- Modify: `src/utils/billing/hosted-status-adapter.ts:30-40`
- Modify: `src/locales/en.yml`、`src/locales/zh-CN.yml`（精确文案）及 `src/locales/` 其余 7 个 yml（英文兜底）

**Interfaces:**

- Produces:
  - `BillingFeature` 含 `"web-pdf-trans"`；`HostedAiTextStreamRoute` 含 `"web-pdf-trans"`（Task 5 依赖）
  - `FeatureKey` 含 `"pdfTranslation"`，`FEATURE_PROVIDER_DEFS.pdfTranslation = { isProvider: isTranslateProvider, getProviderId: (c) => c.pdfTranslation.providerId, configPath: ["pdfTranslation", "providerId"] }`（Task 5 的 provider 解析、Task 8 的侧栏依赖）
  - `config.pdfTranslation` 节点（`translateConfigSchema` 形状，含 providerId 默认值），schema version 100
  - i18n key：`featureProviders.features.pdfTranslation`、`featureProviders.descriptions.pdfTranslation`、`popup.pdfTranslate.tooltip`、`options.tools.pdfTranslate`（Task 7/8 依赖）

- [ ] **Step 1: BillingFeature 加标签**

`src/utils/billing/types.ts` L3-13 的联合类型末尾（`"noteSuggestion"` 之后）加一行：

```ts
  | "web-pdf-trans"
```

- [ ] **Step 2: HostedAiTextStreamRoute 加路由**

`src/types/background-stream.ts` L43-52 改为（`videoSubtitlesSegmentation` 是同款先例：路由字面量 ≠ api-contract 枚举）：

```ts
export type HostedAiTextStreamRoute =
  HostedAiTextStreamFeature | "videoSubtitlesSegmentation" | "web-pdf-trans"
```

**不可修改 `@read-frog/api-contract` 包**（本地 alias `wxt.config.ts` L28-34 指向的也是只读约定）。

- [ ] **Step 3: FeatureKey 三件套**

`src/utils/constants/feature-providers.ts`：

```ts
export const FEATURE_KEYS = [
  "pageTranslation",
  "videoSubtitles",
  "selectionTranslation",
  "inputTranslation",
  "pdfTranslation",
] as const
```

`FEATURE_PROVIDER_DEFS` 加（`isTranslateProvider` 是该文件既有引用，照 `pageTranslation` 抄）：

```ts
  pdfTranslation: {
    isProvider: isTranslateProvider,
    getProviderId: (c: Config) => c.pdfTranslation.providerId,
    configPath: ["pdfTranslation", "providerId"],
  },
```

`FEATURE_KEY_I18N_MAP` 照现有条目的 key 构造方式给 `pdfTranslation` 加一条（最终指向 `featureProviders.features.pdfTranslation`）。

- [ ] **Step 4: config schema + 版本迁移**

`src/types/config/config.ts` L119-137 的 `configSchema` 里，在 `pageTranslation: translateConfigSchema` 旁加：

```ts
  pdfTranslation: translateConfigSchema,
```

（`translateConfigSchema` 自带 providerId 默认值——"默认情况与其他功能默认选择一致"由 schema 默认值天然满足，无需另设。）

`src/utils/constants/config.ts` L52：`CONFIG_SCHEMA_VERSION = 99` → `100`。

新建 `src/utils/config/migration-scripts/v099-to-v100.ts`。**先读 `v098-to-v099.ts` 与迁移注册表，严格照其函数签名/注册方式写**；行为目标：旧配置升级后获得 `pdfTranslation` 节点，值取 schema 默认（等价于下面实现，若注册表签名不同则机械适配，不改行为）：

```ts
import type { Config } from "@/types/config/config"

/** v099 -> v100：新增 pdfTranslation 节点（默认同页面翻译的 schema 默认值）。 */
export function v099ToV100(config: Config): Config {
  return {
    ...config,
    pdfTranslation: config.pdfTranslation ?? {
      providerId: "read-frog-free-ai",
    },
  }
}
```

注意：默认 providerId 以 `translateConfigSchema` 里 providerId 的实际默认值为准——先读 schema，若默认不是 `read-frog-free-ai` 则用实际值。别忘了把新脚本注册进迁移注册表（照 `v098-to-v099.ts` 的注册位置）。

- [ ] **Step 5: hosted 可用性表**

`src/utils/billing/hosted-status-adapter.ts` L30-40 的硬编码 feature 列表加 `"web-pdf-trans"`（内置 AI 对 PDF 翻译的可用性展示）。

- [ ] **Step 6: i18n 文案**

`src/locales/en.yml`：

```yaml
featureProviders:
  features:
    pdfTranslation: PDF translation
  descriptions:
    pdfTranslation: Bilingual side-by-side translation for PDF documents. Works best with a custom API or built-in AI credits.
```

```yaml
popup:
  pdfTranslate:
    tooltip: PDF translation
```

```yaml
options:
  tools:
    pdfTranslate: PDF translation
```

（放进各自已存在的段落里，不新建顶层 key。）

`src/locales/zh-CN.yml`：

```yaml
featureProviders:
  features:
    pdfTranslation: PDF翻译
  descriptions:
    pdfTranslation: PDF 文档对照翻译，建议配合自定义API或充值内置AI使用。
```

```yaml
popup:
  pdfTranslate:
    tooltip: PDF翻译
```

```yaml
options:
  tools:
    pdfTranslate: PDF翻译
```

其余 7 个 locale yml：加同样的英文文案（Global Constraints 的兜底约定）。

- [ ] **Step 7: 排查 FEATURE_KEYS 的其他消费方**

Run: `grep -rn "FEATURE_KEYS" src/ --include="*.ts" --include="*.tsx"`
对每个消费点确认加 `pdfTranslation` 后行为正确（已知：configSchema superRefine L138-158 会自动校验 pdfTranslation.providerId，属预期；若发现快捷键页等 UI 自动多出一项，评估是否该排除，在 commit message 里注明结论）。

- [ ] **Step 8: 类型检查 + 配置测试**

Run: `cd <worktree> && pnpm exec tsc --noEmit && SKIP_FREE_API=true pnpm vitest run src/utils/config src/utils/billing`
Expected: 无报错。若 config 迁移测试有"最新版本号"断言，更新之。

- [ ] **Step 9: Commit**

```bash
git add src/utils/billing/types.ts src/types/background-stream.ts src/utils/constants/feature-providers.ts src/types/config/config.ts src/utils/constants/config.ts src/utils/config/migration-scripts/v099-to-v100.ts src/utils/billing/hosted-status-adapter.ts src/locales/
git commit -m "feat(pdf): 新增 pdfTranslation 配置分组与 web-pdf-trans 计费标签"
```

---

### Task 3: 依赖、静态资源与打包探针（风险隔离）

**Files:**

- Modify: `package.json`、`pnpm-lock.yaml`
- Create: `public/pdf.worker.min.mjs`、`public/ort-wasm-simd-threaded.wasm`、`public/ort-wasm-simd-threaded.mjs`、`public/ort-wasm-simd-threaded.jsep.wasm`、`public/ort-wasm-simd-threaded.jsep.mjs`、`public/cmaps/`（171 项）、`public/standard_fonts/`（16 项）
- Create: `src/entrypoints/pdf-translate/index.html`、`main.ts`（探针版，Task 6 替换）、`viewer.css`（占位，Task 6 替换）

**Interfaces:**

- Produces: 入口 `pdf-translate.html` 可通过 `browser.runtime.getURL("/pdf-translate.html")` 访问；依赖 `pdfjs-dist@4.10.38`、`onnxruntime-web@1.20.1`、`entities`、`katex`（Task 4/6 依赖）

- [ ] **Step 1: 安装依赖**

Run: `cd <worktree> && pnpm add pdfjs-dist@4.10.38 onnxruntime-web@1.20.1 entities katex`

版本必须与 SRC `package.json` 一致（pdfjs-dist ^4.10.38 取 4.10.38 精确版；onnxruntime-web 1.20.1）。注意：**不要**安装 SRC 的 `@types/chrome` 等 devDeps，MeowTabby 已有自己的类型体系。

- [ ] **Step 2: 复制静态资源**

Run:

```bash
cp /Users/Luo_F/vs_code/web_pdf_trans/public/pdf.worker.min.mjs public/
cp /Users/Luo_F/vs_code/web_pdf_trans/public/ort-wasm-simd-threaded*.wasm public/
cp /Users/Luo_F/vs_code/web_pdf_trans/public/ort-wasm-simd-threaded*.mjs public/
cp -R /Users/Luo_F/vs_code/web_pdf_trans/public/cmaps public/cmaps
cp -R /Users/Luo_F/vs_code/web_pdf_trans/public/standard_fonts public/standard_fonts
```

不要复制 SRC 的 icon-\*.png / cv.png（MeowTabby 有自己的图标）。这些资源只被 pdf-translate 扩展页自身加载（同源 `chrome.runtime.getURL`），**无需**加 `web_accessible_resources`；若探针证明需要再回补。

- [ ] **Step 3: 探针入口骨架**

`src/entrypoints/pdf-translate/index.html`（照 SRC `src/entrypoints/viewer/index.html` 的 5 行结构，script 指向 `./main.ts`，根元素 `<div id="app">`）。

`src/entrypoints/pdf-translate/viewer.css` 先放一行注释占位。

`src/entrypoints/pdf-translate/main.ts`（探针版，约 50 行，只验证「pdfjs worker 生效 + ort wasm 可寻址」）：

```ts
import * as pdfjsLib from "pdfjs-dist"

const app = document.getElementById("app")!
const status = document.createElement("div")
status.setAttribute("data-testid", "pdf-status")
app.appendChild(status)

async function run() {
  const workerUrl = chrome.runtime.getURL("/pdf.worker.min.mjs")
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  status.textContent = "worker src set"

  const params = new URLSearchParams(window.location.search)
  const fileUrl = params.get("url")
  if (!fileUrl) {
    status.textContent = "no url param"
    return
  }
  const doc = await pdfjsLib.getDocument(fileUrl).promise
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement("canvas")
  canvas.width = viewport.width
  canvas.height = viewport.height
  app.appendChild(canvas)
  await page.render({
    canvasContext: canvas.getContext("2d")!,
    viewport,
  }).promise
  status.textContent = `ok pages=${doc.numPages}`
}

void run().catch((e) => {
  status.textContent = `error: ${String(e)}`
})
```

（若 MeowTabby 的 lint 要求 `browser.` 而非 `chrome.`，用 `browser.runtime.getURL`，并 `import { browser } from "wxt/browser"` 照仓库既有写法。）

- [ ] **Step 4: 构建**

Run: `cd <worktree> && WXT_SKIP_ENV_VALIDATION=true pnpm build`
Expected: 构建成功，且 `.output/chrome-mv3/pdf.worker.min.mjs`、`.output/chrome-mv3/ort-wasm-simd-threaded.jsep.wasm`、`cmaps/`、`standard_fonts/` 均存在：

```bash
ls .output/chrome-mv3/ | grep -E "worker|ort-wasm"; ls .output/chrome-mv3/cmaps | head -3
```

**若构建失败或 worker/wasm 未产出**：这是阻塞问题，先解决再继续（参考经验：archive/pdf-viewer-absorption 分支验证过 pdfjs worker 的 `?url` 打包可行；本方案用的是 public 静态资源直拷，更简单，理论上更稳）。

- [ ] **Step 5: 实机冒烟**

`chrome://extensions` 加载 `.output/chrome-mv3`，打开 `chrome-extension://<id>/pdf-translate.html?url=<任一线上 PDF 的 https URL>`。
Expected: 页面显示 `ok pages=N` 并渲染出首页图像。

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml public/ src/entrypoints/pdf-translate/
git commit -m "feat(pdf): 引入 pdfjs/onnxruntime 依赖并验证静态资源打包"
```

---

### Task 4: 搬运核心模块与单测

**Files:**

- Create: `src/entrypoints/pdf-translate/modules/`（自 SRC `src/modules/{pdf,layout,assign,viewer,translate}` 逐字复制，约 40+ 文件）
- Create: `src/utils/prompts/pdf-translate.ts`（自 SRC `llm_trans.ts` 的 systemPrompt/targetLangName 提取）
- Create: `src/entrypoints/pdf-translate/modules/translate/segment-utils.ts`（自 SRC `llm_trans.ts` 的 join/split 函数提取）
- Delete（不搬运）: SRC 的 `llm_trans.ts`、`microsoft.ts`

**Interfaces:**

- Produces:
  - `LayoutModelRunner.load(modelUrl?): Promise<LayoutModelRunner>`、`runner.predictPage(canvas, cssW, cssH): Promise<Region[]>`（Task 6 依赖）
  - `loadPdf(url): Promise<PDFDocumentProxy>`、`getTextItems(page): Promise<PdfTextItem[]>`、`createPageHost`、`createTwoPane`、`createTranslateScheduler`、`buildTranslationUnits`（Task 6 依赖）
  - `buildPdfTranslateSystemPrompt(targetCode: string): string`（Task 5 的 promptResolver 依赖）
  - `joinSegments(texts: string[]): string`、`splitSegments(result: string): string[]`、`joinPlain(texts: string[]): string`、`BATCH_SEPARATOR`（若 SRC 内有引用则供 Task 6 使用）
  - 23 个既有单测在新位置全部通过

- [ ] **Step 1: 整体复制**

```bash
mkdir -p src/entrypoints/pdf-translate/modules
cp -R /Users/Luo_F/vs_code/web_pdf_trans/src/modules/pdf  src/entrypoints/pdf-translate/modules/pdf
cp -R /Users/Luo_F/vs_code/web_pdf_trans/src/modules/layout  src/entrypoints/pdf-translate/modules/layout
cp -R /Users/Luo_F/vs_code/web_pdf_trans/src/modules/assign src/entrypoints/pdf-translate/modules/assign
cp -R /Users/Luo_F/vs_code/web_pdf_trans/src/modules/viewer src/entrypoints/pdf-translate/modules/viewer
cp -R /Users/Luo_F/vs_code/web_pdf_trans/src/modules/translate src/entrypoints/pdf-translate/modules/translate
```

**先不改任何内容**，确保逐字副本（Global Constraints：引擎零改动）。

- [ ] **Step 2: 提取翻译 prompt 到共享位置**

新建 `src/utils/prompts/pdf-translate.ts`，内容 = SRC `src/modules/translate/llm_trans.ts` L19-71 的 `targetLangName`（8 语言映射）与 `systemPrompt(to)` **逐字**搬入，导出为：

```ts
export function targetLangName(to: string): string {
  /* SRC L19-25 原文 */
}
export function buildPdfTranslateSystemPrompt(to: string): string {
  /* SRC L27-71 systemPrompt 原文 */
}
```

- [ ] **Step 3: 提取分段工具、删除直连客户端**

先查引用面：

```bash
grep -rn "joinSegments\|joinPlain\|splitSegments\|BATCH_SEPARATOR" src/entrypoints/pdf-translate/modules/ --include="*.ts" | grep -v __tests__
```

把被引用的函数（SRC `llm_trans.ts` L5-6、L74-98 原文）逐字搬进 `src/entrypoints/pdf-translate/modules/translate/segment-utils.ts` 并更新引用处的 import。然后**删除** `modules/translate/llm_trans.ts` 与 `modules/translate/microsoft.ts`（硬编码 ark key/baseUrl、直连通道，Global Constraints 禁止携带）。`sentence-split.ts`、`cross-page.ts` 原样保留。

- [ ] **Step 4: 修 import 路径**

SRC 的 `@` alias 指向 SRC 的 `src`，复制后 `@/modules/...` 全部失效。逐文件改为相对路径（如 `modules/viewer/render-view.ts` 内的 `@/modules/viewer/coords-rot` → `./coords-rot`）。**只改 import 行，不改逻辑**。

```bash
grep -rn "@/modules" src/entrypoints/pdf-translate/ --include="*.ts" | wc -l   # 目标：0
```

- [ ] **Step 5: 修测试并跑通**

SRC 的 23 个单测随模块目录一起复制过来了（`modules/**/__tests__/*.test.ts`）。它们用的 vitest alias `@`→src 与 MeowTabby 一致，改完 Step 4 的 import 后：

Run: `cd <worktree> && SKIP_FREE_API=true pnpm vitest run src/entrypoints/pdf-translate`
Expected: 全部通过。若有用例因 import 失败，只修 import；**不得**为让测试通过而改模块逻辑——改不动就停下来排查。

- [ ] **Step 6: 类型检查**

Run: `cd <worktree> && pnpm exec tsc --noEmit`
Expected: 无报错（重点看 onnxruntime-web / pdfjs-dist 类型解析；SRC 曾确认 pdfjs-dist 4.x 自带类型，无需 @ts-expect-error）。

- [ ] **Step 7: Commit**

```bash
git add src/entrypoints/pdf-translate/modules/ src/utils/prompts/pdf-translate.ts
git commit -m "feat(pdf): 移植 web_pdf_trans 版面识别与对照渲染模块"
```

---

### Task 5: 翻译通道接 billing（消息协议 + background handler）

**Files:**

- Modify: `src/utils/message.ts`（ProtocolMap，L26 起的接口）
- Modify: `src/entrypoints/background/translation-queues.ts`（新增 setUpPdfTranslation）
- Modify: `src/entrypoints/background/index.ts`（L123-124 附近注册）
- Modify: `src/utils/prompts/pdf-translate.ts`（补 PromptResolver）
- Test: `src/utils/prompts/__tests__/pdf-translate.test.ts`

**Interfaces:**

- Consumes: `executeQueuedTranslation(text, langConfig, provider, promptResolver, opts)`（`translation-queues.ts` 既有，签名见 `executeBatchTranslation` L151-170 的调用式）；`FEATURE_PROVIDER_DEFS.pdfTranslation`（Task 2）；`buildPdfTranslateSystemPrompt`（Task 4）
- Produces: 消息 `translatePdfRequest: (data: { text: string; to: string }) => Promise<string>`（Task 6 的 viewer 依赖）；`setUpPdfTranslation(): void`

- [ ] **Step 1: 写 prompt 的失败测试**

Create `src/utils/prompts/__tests__/pdf-translate.test.ts`：

```ts
import { describe, expect, it } from "vitest"
import { buildPdfTranslateSystemPrompt } from "../pdf-translate"

describe("buildPdfTranslateSystemPrompt", () => {
  it("keeps the %% batch-separator rules intact", () => {
    const prompt = buildPdfTranslateSystemPrompt("zh")
    expect(prompt).toContain("%%")
    expect(prompt).toContain("Translation Rules")
  })

  it("maps language codes to names", () => {
    expect(buildPdfTranslateSystemPrompt("zh")).toContain("Chinese")
    expect(buildPdfTranslateSystemPrompt("en")).toContain("English")
    expect(buildPdfTranslateSystemPrompt("ja")).toContain("Japanese")
  })

  it("keeps the LaTeX preservation rule", () => {
    expect(buildPdfTranslateSystemPrompt("zh")).toContain("LaTeX")
    expect(buildPdfTranslateSystemPrompt("zh")).toContain("$")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd <worktree> && SKIP_FREE_API=true pnpm vitest run src/utils/prompts/__tests__/pdf-translate.test.ts`
Expected: FAIL（`buildPdfTranslateSystemPrompt` 未导出——Task 4 已建文件但只导出了 prompt 生成，若已导出则本步直接过）

- [ ] **Step 3: 补 PromptResolver**

`src/utils/prompts/pdf-translate.ts` 追加。**先读** `PromptResolver` 的类型定义（`translation-queues.ts` 顶部 import 处）确认参数签名，再写（以下按最常见的 `(text, langConfig, ...)` 签名，若实际不同机械适配）：

```ts
import type { PromptResolver } from "@/entrypoints/background/translation-queues"
import type { Config } from "@/types/config/config"

export const pdfPromptResolver: PromptResolver = (_text, langConfig: Config["language"]) =>
  buildPdfTranslateSystemPrompt(langConfig.targetCode)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd <worktree> && SKIP_FREE_API=true pnpm vitest run src/utils/prompts/__tests__/pdf-translate.test.ts`
Expected: 3 passed

- [ ] **Step 5: 消息协议**

`src/utils/message.ts` 的 `ProtocolMap`（`enqueueTranslateRequest` L88-112 之后）追加：

```ts
/** PDF 对照翻译：viewer 页把一条翻译请求（可能含 %% 多段）发来，background
 * 按设置页「PDF翻译」的 provider 走 billing 队列（feature=web-pdf-trans），
 * 返回带 %% 段结构的原始译文，由 viewer 自行拆分回填。 */
translatePdfRequest: (data: { text: string; to: string }) => Promise<string>
```

- [ ] **Step 6: background handler**

`src/entrypoints/background/translation-queues.ts` 追加。**先读** `setUpWebPageTranslationQueue`（L494-523）：照它的 `loadQueueSetupConfig("webpage", selectWebPageQueueConfig)` + `watchQueueConfig` 写法，新增 `selectPdfQueueConfig`（把 providerId 来源从 `config.pageTranslation` 换成 `config.pdfTranslation`——用 Task 2 的 `FEATURE_PROVIDER_DEFS.pdfTranslation` + `resolveProviderConfig`（feature-providers.ts L67-83）解析 providerRef；`langConfig` 取法照抄 webpage 版）并建 `getPdfQueueSetupConfig`。然后：

```ts
export function setUpPdfTranslation(): void {
  onMessage("translatePdfRequest", async ({ data }) => {
    const { text, to } = data
    const { langConfig, providerRef } = await getPdfQueueSetupConfig()
    const mergedLangConfig =
      to && to !== langConfig.targetCode ? { ...langConfig, targetCode: to } : langConfig

    return await executeQueuedTranslation(text, mergedLangConfig, providerRef, pdfPromptResolver, {
      isBatch: true,
      hostedRequestId: providerRef.kind === "system" ? getRandomUUID() : undefined,
      hostedFeature: "web-pdf-trans",
    })
  })
}
```

要点：

- 用 `executeQueuedTranslation` **而不是** `executeBatchTranslation`——后者会按 `%%` 把结果拆成数组返回，而 viewer 需要带 `%%` 结构的原始字符串（SRC 的 `translateWithLlm_trans` 语义）。
- `isBatch: true` 对齐"一条请求含多段"的语义；若读 `executeQueuedTranslation` 实现发现 isBatch 影响 prompt 组装并产生冲突，以 `pdfPromptResolver` 的输出为准，在 commit message 说明取舍。
- `getRandomUUID`、`onMessage` 是该文件既有 import，缺则照 `setUpWebPageTranslationQueue` 补。

- [ ] **Step 7: 注册**

`src/entrypoints/background/index.ts`：把 `setUpPdfTranslation` 加入 L34 的 `from "./translation-queues"` import；在 L123-124 的 `setUpWebPageTranslationQueue()` / `setUpSubtitlesTranslationQueue()` 之后加：

```ts
setUpPdfTranslation()
```

必须在该同步区块内（MV3 要求所有队列 handler 在 SW 第一个同步 turn 注册完）。

- [ ] **Step 8: 回归**

Run: `cd <worktree> && pnpm exec tsc --noEmit && SKIP_FREE_API=true pnpm vitest run src/entrypoints/background/ src/utils/prompts/`
Expected: 全部通过

- [ ] **Step 9: Commit**

```bash
git add src/utils/message.ts src/entrypoints/background/translation-queues.ts src/entrypoints/background/index.ts src/utils/prompts/
git commit -m "feat(pdf): 翻译通道接入 billing 队列，计费标签 web-pdf-trans"
```

---

### Task 6: 完整 viewer 搬运与接线

**Files:**

- Modify（替换探针版）: `src/entrypoints/pdf-translate/main.ts`
- Replace: `src/entrypoints/pdf-translate/viewer.css`（自 SRC `src/entrypoints/viewer/viewer.css` 逐字复制，172 行）

**Interfaces:**

- Consumes: Task 3 的静态资源与依赖、Task 4 的全部模块导出、Task 5 的 `sendMessage("translatePdfRequest", ...)`
- Produces: `pdf-translate.html` 完整功能——`?url=<pdf>&to=<lang>` 打开对照翻译；无 `url` 参数时显示"打开 PDF"按钮（合拢计划第 2 条的空白页）

- [ ] **Step 1: 复制 main.ts 与 css**

```bash
cp /Users/Luo_F/vs_code/web_pdf_trans/src/entrypoints/viewer/main.ts src/entrypoints/pdf-translate/main.ts
cp /Users/Luo_F/vs_code/web_pdf_trans/src/entrypoints/viewer/viewer.css src/entrypoints/pdf-translate/viewer.css
```

- [ ] **Step 2: 五处机械修改**（其余 530 行零改动）

1. **URL 参数**（SRC L98-113）：删除 `model`、`llm_trans_url`、`llm_trans_key`、`llm_trans_model` 的解析与 `Llm_transClientOptions` 构造；保留 `url`、`to`（`from` 参数一并删除，SRC 中未被翻译链路使用）。
2. **删除** `translateWithLlm_trans` 的 import（llm_trans.ts 已不存在）。
3. **翻译回调**（SRC L200-206）：改为

```ts
import { sendMessage } from "@/utils/message"

const translator = createTranslateScheduler({
  maxConcurrentPages: MAX_CONCURRENT_PAGES,
  translate: (text: string) => sendMessage("translatePdfRequest", { text, to }).then((r) => r.data),
  onError: (err, text) => {
    /* 照 SRC 原文的 onError 逻辑保留 */
  },
})
```

（`sendMessage` 返回值结构以 webext-core 实际为准——`{ data }` 解包，对照 MeowTabby 既有 `sendMessage` 调用点写法。）

4. **无 url 空白页**（SRC 无 url 时仅提示用法并 return 的分支）：改为渲染"打开 PDF"按钮 + 文件选择，选完文件就地启动（blob URL 跨导航会失效，**不能**跳转），伪代码骨架：

```ts
if (!pdfUrl) {
  renderOpenPdfButton({
    onFile: (file: File) => start(URL.createObjectURL(file), to),
  })
  return
}
start(pdfUrl, to)
```

把原 main.ts 的初始化流程（L117-539：installErrorBanner → LayoutModelRunner.load → loadPdf → createTwoPane → …）整体收进 `start(pdfUrl: string, to: string)` 函数。`renderOpenPdfButton` 用原生 DOM（`<input type="file" accept="application/pdf">`，样式贴 viewer.css，文案用 `popup.pdfTranslate` 同级新增 i18n key `pdfTranslate.openFile`，en: "Open PDF" / zh-CN: "打开 PDF"，Task 6 内补进所有 locale）。

5. **模型加载**：`LayoutModelRunner.load()` 无参调用（SRC 默认 hf.co URL + 15s 超时 + hf-mirror 兜底 + Cache API 缓存，Global Constraints 的"运行时下载+缓存"即此逻辑，零改动）。

- [ ] **Step 3: 构建 + lint**

Run: `cd <worktree> && WXT_SKIP_ENV_VALIDATION=true pnpm build && pnpm lint`
Expected: 均通过。lint 报 `no-shadow`/`any` 之类时修写法**不改逻辑**。

- [ ] **Step 4: 实机冒烟（内置 AI / billing 通路）**

加载扩展，登录内置 AI，浏览器打开 `chrome-extension://<id>/pdf-translate.html?url=<arxiv 论文 PDF>&to=zh`。
Expected: 左页原文、右页译文对照渲染；网络面板确认翻译请求走 `WXT_BILLING_API_URL` 的 `/v1/generate`。

- [ ] **Step 5: 实机冒烟（自配 provider 通路）**

设置页把「PDF翻译」provider 换成自配的 OpenAI 兼容 API，重开一份 PDF。
Expected: 译文正常产出，且 billing 后端 `usage_log` 无本次记录（验证见 Task 9 Step 2 的 SQL）。

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/pdf-translate/ src/locales/
git commit -m "feat(pdf): 移植对照翻译 viewer 并接入内置AI/自配通道"
```

---

### Task 7: popup 图标入口 + PDF 页面检测

**Files:**

- Create: `src/utils/pdf-detect.ts`
- Test: `src/utils/__tests__/pdf-detect.test.ts`
- Create: `src/entrypoints/popup/components/pdf-translate-button.tsx`
- Modify: `src/entrypoints/popup/app.tsx:25-30`
- Modify: `src/locales/`（Task 6 已加 `popup.pdfTranslate` 段）

**Interfaces:**

- Consumes: `pdf-translate.html`（Task 6）；`TRANSLATION_HUB_PAGE_PATH` 的常量模式（`src/utils/constants/translation-hub.ts`）
- Produces:
  - `looksLikePdfUrl(url: string): boolean`
  - popup 图标按钮：当前 tab 是 PDF → `pdf-translate.html?url=<encodeURIComponent(tab.url)>&to=<config language targetCode>`；否则 → `pdf-translate.html`（空白页，含打开按钮）

- [ ] **Step 1: 写检测的失败测试**

Create `src/utils/__tests__/pdf-detect.test.ts`：

```ts
import { describe, expect, it } from "vitest"
import { looksLikePdfUrl } from "../pdf-detect"

describe("looksLikePdfUrl", () => {
  it("detects .pdf suffix (case-insensitive)", () => {
    expect(looksLikePdfUrl("https://example.com/paper.pdf")).toBe(true)
    expect(looksLikePdfUrl("https://example.com/paper.PDF")).toBe(true)
  })

  it("detects path-style pdf routes like arxiv", () => {
    expect(looksLikePdfUrl("https://arxiv.org/pdf/2401.00001v2")).toBe(true)
  })

  it("rejects non-pdf urls", () => {
    expect(looksLikePdfUrl("https://example.com/")).toBe(false)
    expect(looksLikePdfUrl("https://example.com/paper.html")).toBe(false)
    expect(looksLikePdfUrl("chrome-extension://abc/popup.html")).toBe(false)
  })

  it("does not false-positive on urls merely containing 'pdf' in query", () => {
    expect(looksLikePdfUrl("https://example.com/page?file=pdf-notes")).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd <worktree> && SKIP_FREE_API=true pnpm vitest run src/utils/__tests__/pdf-detect.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现检测**

Create `src/utils/pdf-detect.ts`：

```ts
/** URL 启发式：判断一个 tab URL 是否像 PDF。真正的确认由 viewer 加载失败兜底。 */
export function looksLikePdfUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url)
    if (pathname.toLowerCase().endsWith(".pdf")) return true
    return /\/pdf\//.test(pathname)
  } catch {
    return false
  }
}
```

Run: `cd <worktree> && SKIP_FREE_API=true pnpm vitest run src/utils/__tests__/pdf-detect.test.ts`
Expected: 4 passed

- [ ] **Step 4: popup 按钮组件**

Create `src/entrypoints/popup/components/pdf-translate-button.tsx`。结构照同目录 `translation-hub-button.tsx`（Tooltip + `Button variant="ghost" size="icon"` + 读 config 的 atom 模式），核心差异：

```tsx
// 合拢计划第 1 条指定的图标（base64 SVG）
const PDF_ICON_DATA_URI =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxZW0iIGhlaWdodD0iMWVtIiB2aWV3Qm94PSIwIDAgMjU2IDI1NiI+Cgk8cGF0aCBkPSJNMCAwaDI1NnYyNTZIMHoiIGZpbGw9Im5vbmUiIC8+Cgk8cGF0aCBmaWxsPSJjdXJyZW50Q29sb3IiIGQ9Ik0yMjIgMTUyYTYgNiAwIDAgMS02IDZoLTI2djIwaDE4YTYgNiAwIDAgMSAwIDEyaC0xOHYxOGE2IDYgMCAwIDEtMTIgMHYtNTZhNiA2IDAgMCAxIDYtNmgzMmE2IDYgMCAwIDEgNiA2TTkwIDE3MmEyNiAyNiAwIDAgMS0yNiAyNkg1NHYxMGE2IDYgMCAwIDEtMTIgMHYtNTZhNiA2IDAgMCAxIDYtNmgxNmEyNiAyNiAwIDAgMSAyNiAyNm0tMTIgMGExNCAxNCAwIDAgMC0xNC0xNEg1NHYyOGgxMGExNCAxNCAwIDAgMCAxNC0xNG04NCA4YTM0IDM0IDAgMCAxLTM0IDM0aC0xNmE2IDYgMCAwIDEtNi02di01NmE2IDYgMCAwIDEgNi02aDE2YTM0IDM0IDAgMCAxIDM0IDM0bS0xMiAwYTIyIDIyIDAgMCAwLTIyLTIyaC0xMHY0NGgxMGEyMiAyMiAwIDAgMCAyMi0yMk00MiAxMTJWNDBhMTQgMTQgMCAwIDEgMTQtMTRoOTZhNiA2IDAgMCAxIDQuMjUgMS43Nmw1NiA1NkE2IDYgMCAwIDEgMjE0IDg4djI0YTYgNiAwIDAgMS0xMiAwVjk0aC01MGE2IDYgMCAwIDEtNi02VjM4SDU2YTIgMiAwIDAgMC0yIDJ2NzJhNiA2IDAgMCAxLTEyIDBtMTE2LTMwaDM1LjUyTDE1OCA0Ni40OFoiIC8+Cjwvc3ZnPgo="

const PDF_TRANSLATE_PAGE_PATH = "/pdf-translate.html"

async function resolvePdfTargetUrl(): Promise<string> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  const viewerUrl = browser.runtime.getURL(PDF_TRANSLATE_PAGE_PATH)
  if (!tab?.url || !looksLikePdfUrl(tab.url)) {
    return viewerUrl // 非 PDF → 空白页（含打开 PDF 按钮）
  }
  return `${viewerUrl}?url=${encodeURIComponent(tab.url)}`
}

// handleClick: browser.tabs.create({ url: await resolvePdfTargetUrl() })
// 按钮内用 <img src={PDF_ICON_DATA_URI} className="size-4" alt="" /> 代替 <Icon />
// tooltip 文案 i18n.t("popup.pdfTranslate.tooltip")
```

（config atom、Tooltip 包裹等其余部分照 `translation-hub-button.tsx` 抄；本按钮无快捷键，不写 `formatHotkeyParts`。）

- [ ] **Step 5: 挂到 popup（翻译中心左边）**

`src/entrypoints/popup/app.tsx` L25-30 的容器改为（新图标在 TranslationHubButton 之前渲染，即"翻译中心左边"）：

```tsx
<div className="flex shrink-0 items-center">
  <PdfTranslateButton />
  <TranslationHubButton />
</div>
```

- [ ] **Step 6: 构建 + 实机冒烟**

Run: `cd <worktree> && WXT_SKIP_ENV_VALIDATION=true pnpm build && pnpm exec tsc --noEmit`

实机：

- 打开 arxiv PDF 页 → 点图标 → 对照翻译页加载该 PDF
- 打开普通网页 → 点图标 → 空白页（有"打开 PDF"按钮，选本地 PDF 能正常进入对照翻译）

- [ ] **Step 7: Commit**

```bash
git add src/utils/pdf-detect.ts src/utils/__tests__/pdf-detect.test.ts src/entrypoints/popup/
git commit -m "feat(pdf): popup 新增 PDF 翻译入口并实现 PDF 页检测"
```

---

### Task 8: 设置页侧栏入口

**Files:**

- Modify: `src/entrypoints/options/app-sidebar/features-nav.tsx:137-151`

**Interfaces:**

- Consumes: `PDF_TRANSLATE_PAGE_PATH`（Task 7 定义；若引用跨目录不便，把该常量上移到 `src/utils/constants/translation-hub.ts` 同级新文件 `src/utils/constants/pdf-translate.ts` 并同步 Task 7 的 import）
- Produces: 侧栏「翻译中心」下方出现「PDF翻译」入口，点击新标签打开空白 viewer（合拢计划第 3 条）

- [ ] **Step 1: 照翻译中心条目加菜单项**

在 features-nav.tsx L137-151 的「翻译中心」`<SidebarMenuItem>` 之后加（跳转逻辑与其一致——`<a>` 新标签打开扩展页）：

```tsx
<SidebarMenuItem>
  <SidebarMenuButton
    render={
      <a
        href={browser.runtime.getURL("/pdf-translate.html")}
        target="_blank"
        rel="noopener noreferrer"
      />
    }
    tooltip={i18n.t("options.tools.pdfTranslate")}
  >
    <img src={PDF_ICON_DATA_URI} className="size-4" alt="" />
    <span>{i18n.t("options.tools.pdfTranslate")}</span>
  </SidebarMenuButton>
</SidebarMenuItem>
```

`PDF_ICON_DATA_URI` 与 Task 7 同一常量（从 `src/utils/constants/pdf-translate.ts` import，别复制两份）。

- [ ] **Step 2: 实机验证**

打开设置页：侧栏「翻译中心」下方出现「PDF翻译」；点击新标签打开空白 viewer。模型选择页（options/pages/model-selection）出现「PDF翻译」分组且默认 provider 与其他功能一致（Task 2 的成果在此验收）。

- [ ] **Step 3: Commit**

```bash
git add src/entrypoints/options/ src/utils/constants/
git commit -m "feat(pdf): 设置页新增 PDF翻译 入口"
```

---

### Task 9: 端到端验收与收尾

**Files:** 无新增（纯验证 + 可能的小修）

- [ ] **Step 1: 敏感残留清零**

Run:

```bash
grep -rn "ark-6b97\|ark.cn-beijing\|llm_trans_url\|llm_trans_key\|llm_trans_model\|DEFAULT_API_KEY" src/ && echo FOUND || echo CLEAN
```

Expected: `CLEAN`

- [ ] **Step 2: billing 后端记录验证**

登录内置 AI 翻译一页 PDF 后，在 billing-backend 侧确认 feature 逐字为 `web-pdf-trans`（后端零代码改动，`feature` 是自由字符串入 `usage_log.feature` 列，main.py L307-321）：

```bash
sqlite3 /Users/Luo_F/vs_code/billing-backend/*.db "SELECT feature, model, created_at FROM usage_log ORDER BY rowid DESC LIMIT 3;"
```

Expected: 最新一条 `feature = web-pdf-trans`（db 文件名以 billing-backend 目录实际为准，`ls *.db`）。

- [ ] **Step 3: 全量测试 + lint + 构建**

Run: `cd <worktree> && SKIP_FREE_API=true pnpm vitest run && pnpm lint && WXT_SKIP_ENV_VALIDATION=true pnpm build`
Expected: 全部通过

- [ ] **Step 4: 版面识别准确性验收**

用 SRC 验证过的样本各一份：单栏（arxiv）、双栏（ACL P19-1139）。逐页检查：段落切分、标题识别、图/表/公式保留位图、图注独立翻译、脚注不进正文、双栏阅读顺序、跨页段落合并。Expected: 与 SRC 独立运行结果一致（引擎逐字搬运，理论零回归）。

- [ ] **Step 5: 功能验收清单（合拢计划 6 条逐条勾）**

- [ ] 第 1 条：popup「翻译中心」左边有 PDF 图标
- [ ] 第 2 条：PDF 页点击直达对照翻译；非 PDF 页点击到带"打开 PDF"按钮的空白页
- [ ] 第 3 条：设置页「翻译中心」下有「PDF翻译」，跳转行为一致
- [ ] 第 4 条：模型选择页有「PDF翻译」分组，默认值与其他功能一致，文案第一行「PDF翻译」、描述含「PDF对照翻译…建议配合自定义API或充值内置AI」
- [ ] 第 5 条：内置 AI 通路计费标签 `web-pdf-trans`（Step 2 已验）
- [ ] 第 6 条：无任何直连 LLM 的 key/baseUrl 残留（Step 1 已验）

- [ ] **Step 6: 收尾提交**

```bash
git add -A
git commit -m "test(pdf): web_pdf_trans 合拢端到端验收"
```

---

## 自审记录

- **Spec 覆盖**：合拢计划第 1 条 → Task 7；第 2 条 → Task 6 Step 2.4（空白页按钮）+ Task 7（检测跳转）；第 3 条 → Task 8；第 4 条 → Task 2（分组/默认值/i18n）+ Task 8 Step 2（验收）；第 5 条 → Task 2 Step 1/2（标签）+ Task 5（通道）+ Task 9 Step 2（后端验证，零代码改动）；第 6 条 → Task 4 Step 3（删直连）+ Task 9 Step 1。补充项 7（检测接缝）→ Task 7；8（模型分发）→ Global Constraints + Task 6 Step 2.5；9（静态资源）→ Task 3；10（权限）→ Global Constraints 结论 + Task 9 复查；11（前后端改动）→ Task 2/5 + 后端零改动结论；12（模型选择页实现位置）→ Task 2 Step 3；13（absorption 弃用）→ Global Constraints；14（分支时机）→ Task 1；15（过时文档）→ 本计划不引用 SRC 的 docs/。
- **类型一致性**：`"web-pdf-trans"`（计费标签）与 `pdfTranslation`（FeatureKey）两个名字在各任务中拼写已核对统一；`translatePdfRequest` 的载荷 `{ text, to }` 在 Task 5 协议、Task 5 handler、Task 6 调用三处一致；`buildPdfTranslateSystemPrompt` / `joinSegments` / `splitSegments` / `looksLikePdfUrl` 命名前后一致。
- **已知不确定点（已在任务内给出排查步骤，不构成占位符）**：① Task 5 的 `PromptResolver` 与 `loadQueueSetupConfig` 精确签名需 executor 现场对齐（已给对齐基准行号）；② Task 2 迁移脚本需照 v098-to-v099 的注册表签名机械适配；③ Task 6 的 `sendMessage` 返回值解包写法以仓库既有调用点为准。
