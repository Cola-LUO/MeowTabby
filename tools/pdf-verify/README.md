# PDF 内部验证工具

## 目录

1. [启动](#1-启动)
2. [使用](#2-使用)
3. [离线核验](#3-离线核验)
4. [资料与构建边界](#4-资料与构建边界)

## 1. 启动

在 MeowTabby 根目录执行（先 `cd` 进入根目录）。依赖只安装在根目录，不在工具目录再装一套。

```sh
cd /Users/Luo_F/vs_code/MeowTabby

pnpm dev:pdf-verify
pnpm build:pdf-verify
pnpm build:pdf-verify:edge
pnpm build:pdf-verify:firefox
```

如果本机 pnpm 正在自动下载 Node 而无法继续，可直接使用已安装的 WXT：

```sh
cd /Users/Luo_F/vs_code/MeowTabby

node node_modules/wxt/bin/wxt.mjs build tools/pdf-verify
```

把 `tools/pdf-verify/.output/chrome-mv3` 作为未打包扩展载入 Chrome。点击扩展图标打开验证页。Edge 对应 `edge-mv3`。Firefox 对应 `firefox-mv3`，但目录选择器依赖浏览器的 File System Access API，Firefox 不支持该操作。

## 2. 使用

选择或拖入 PDF。工具只运行共用 D 流程，展示原始/补框后的检测框、段落框、正文和标题的连续阅读编号，以及组成员摘抄、评分和未通过的配对。

状态区显示页进度和仍在等待接续的段落数。某页失败或阅读序没有排完时停止处理，并显示页码。文件结尾会明确结束等待。

勾选切片后，选择 `MeowTabby/tools/pdf-verify/slices` 文件夹。扩展来源变了，旧扩展保存的目录授权不能沿用，需要重新选择一次。JSON 文件仍可复用。首次处理新 PDF 会保存原始检测框，再次打开同一 PDF 会复用检测框，后处理仍运行共用核心。

验证页 URL 加 `?wasm` 可强制使用 WASM。默认尝试 WebGPU，无法使用时回退 WASM。

模型放在被 Git 忽略的 `model-store/doclayout_yolo.onnx`。当前迁入模型 SHA-256：

```text
fece9af02f618b603ff7921ccec6861d13e7e1f9830e091dfb7e8ad9311e5b21
```

新切片会记录模型和预处理指纹。旧切片没有此字段，仅在上述原模型、1024 输入、stride 32、置信度 0.25 下复用。改变预处理或检测规则时，也必须更新 `src/slice-format.ts` 的指纹版本。

## 3. 离线核验

已有切片时，无需启动浏览器或运行模型。PDF 文件需要自行保留，按文件哈希找到对应切片。

```sh
cd /Users/Luo_F/vs_code/MeowTabby

node tools/pdf-verify/dev/offline.mjs /绝对路径/样本.pdf tools/pdf-verify/slices /tmp/result.json
```

脚本直接调用 `analyzePage` 和 `createDocumentFlow`，输出归属后的段落、包络、阅读序、配对决定和最终组。缺页或切片不匹配时明确报错。

浏览器已通过调试端口启动并打开验证页时，也可以上传 PDF 并收集日志。脚本从当前页面 URL 识别扩展 ID，无需沿用旧项目的 ID：

```sh
cd /Users/Luo_F/vs_code/MeowTabby

CDP_PORT=9223 node tools/pdf-verify/dev/browser.mjs /绝对路径/样本.pdf /tmp/browser.jsonl
```

## 4. 资料与构建边界

`slices` 保留原有 505 个 JSON（504 个逐页文件、1 个导出文件）。`archive` 是只用于回看的 HTML 报告、诊断记录和问题笔记，不参与构建。原始文字夹具及回归测试已放在 `src/modules/pdf-core/__tests__/`，工具不再复制算法或维护旧方案脚本。

`dev/reference` 保留外部 Docling 参考脚本，其 Python 环境和样本要求见该目录 README。外部 PDF、Python 安装环境不属于已迁入的数据。

工具的入口发现、public 目录、`.wxt` 与 `.output` 均独立。PDF.js 字库、CMap、Worker 和 ORT 文件统一读取 MeowTabby 的 `public` 源文件，模型从 `model-store` 直接复制到本次验证输出。正式构建只有显式设置 `WXT_BUNDLE_MODEL=true` 才带模型，不向 public 写临时模型。

正式构建后执行 `pnpm check:pdf-packaging` 可检查安装目录、现有 ZIP 与源码 ZIP 的隔离情况。
