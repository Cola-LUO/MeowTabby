# web_pdf_trans —— 项目合并文档（最终版）

> 本项目已合入 MeowTabby 主仓库，原目录 `web_pdf_trans/` 保留代码归档，后续删除。
> 本文档是**实现文档 + 技术文档**的合并体，覆盖架构、数据流、模块职责、关键算法、验收指标、已知限制与设计演进线索。
> 源代码为唯一事实来源，本文档不重复注释细节，只描述模块间契约与设计决策。

---

## 1. 项目定位

浏览器内 PDF 左右对照翻译——**版面识别模型驱动**的方案验证项目。与 read-frog（上游几何启发式方案）并行，本项目的分块由 **DocLayout-YOLO 版面检测模型** 给出，最终结论用于决定整编进 MeowTabby 的技术路线。

- 技术栈：WXT 0.21 + TypeScript + React 19 + Tailwind + pnpm + vitest
- 核心依赖：pdfjs-dist 4.10.38、onnxruntime-web 1.20.1（JSEP 构建）、katex 0.18.7
- 模型：`doclayout_yolo_docstructbench_imgsz1024.onnx`（71.8MB，DocStructBench 10 类）
- 翻译后端：OpenAI 兼容接口（默认火山引擎 DeepSeek v4 flash，可 URL 参数覆盖）
- 输出：Chrome MV3 扩展（调试态也可直接用本地静态服务器访问 `viewer.html`）

---

## 2. 管线架构

```
PDF 文件
  │
  ▼ pdfjs-dist
  ├─ getDocument → PDFDocumentProxy
  ├─ page.render() → 整页位图 canvas（RENDER_SCALE = dpr×2，上限 3）
  └─ getTextContent() → PdfTextItem[]（PDF y-up 空间；过滤旋转文字）
  │
  ▼ layout.ModelRunner（onnxruntime-web）
  letterbox 1024 预处理 → ONNX 推理 → 解码 → 坐标还原
  → Region[] = { x1,y1,x2,y2, className, conf, behavior }
  │
  ▼ layout.repairRegions
  ① 孤立行吸收：translate 区域沿视觉行吸收两端无主碎片
  ② 同类重叠合并：重叠过半的 translate 区域取包络
  │
  ▼ assign.assignItems
  排他认领（keep → translate 按 conf 降序 → skip 最后）
  → AssignedBlock[]，每块内段落由 buildLines + mergeParagraphs 生成
  │     ├─ 跨栏合并判定 cross-merge.planSamePageMerges
  │     └─ 跨页裁定 cross-page.decideCrossPage（pendingTail 状态机）
  │
  ▼ translate.scheduler（并发调度）
  页内全并行 / 页间在途页数 ≤ 2 / 同文本在途去重
  → Unit[]（每条 = 送翻请求 + 回填闭包）
  │
  ▼ translate.llm_trans
  OpenAI 兼容端点，系统提示词约束 %% 分段 / LaTeX 公式 / 仅输出译文
  │
  ▼ viewer.cluster-layout + fit-text + fit-line-height
  排版三步求解：缩字号（只缩）→ 拉行高（只增）→ 定盒高（不越障碍）
  │
  ▼ viewer.renderBlocks + fillMixedText
  双栏三层 DOM：canvas（左原文 / 右副本）+ 译文层（原位白底簇盒）+ 调试叠加层
```

### 类别 → 行为映射

类别名来自 ONNX metadata（DocStructBench 10 类），运行时自动发现，兜底表 `MODEL_CLASSES`。

| 类别                                                              | 行为             | 说明                              |
| ----------------------------------------------------------------- | ---------------- | --------------------------------- |
| title                                                             | translate + 覆盖 | 整块一并送翻，不插 %% 分段        |
| plain text                                                        | translate + 覆盖 | 正文，块内段落用 %% 连接          |
| figure_caption / table_caption / formula_caption / table_footnote | translate + 覆盖 | 图注/表注/公式注/表注脚           |
| figure / table / isolate_formula                                  | keep（不覆盖）   | 位图原样透出，零译文块            |
| abandon                                                           | skip             | 认领文字但不参与 repair，兜底处理 |

**不变式**：`CLASS_BEHAVIOR`（decode.ts）和 `CLASS_COLORS`（debug-panel.ts）必须覆盖全部 `MODEL_CLASSES`。单测 `class-tables.test.ts` 校验覆盖——漏一类即表现为"这个框好像没分类"。

---

## 3. 目录结构

```
src/
├── entrypoints/viewer/
│   ├── index.html          # 页面骨架
│   ├── main.ts             # 管线编排、状态机、验收采集（单文件 ~540 行）
│   └── viewer.css          # 双栏 + 调试面板样式 + 溢出 mask
└── modules/
    ├── pdf/
    │   ├── loader.ts       # pdfjs 初始化 + worker/cmap/标准字体路径
    │   ├── render.ts       # RENDER_SCALE 常量 + 渲染整页到 canvas
    │   └── text-items.ts   # getTextContent → normalizeItems（过滤旋转 / 合并 small-caps / ASCENT=0.8）
    ├── layout/
    │   ├── model-runner.ts # LayoutModelRunner 类：ORT 会话创建（webgpu→wasm 回退）、Cache API 模型缓存、hf-mirror 自动回退、predictPage / predictTensor
    │   ├── preprocess.ts   # letterbox（与 BabelDOC resize_and_pad_image 一致）
    │   ├── decode.ts       # 兼容三种 YOLO 输出布局的解码 + NMS + 坐标缩放 + 类别行为映射
    │   └── repair.ts       # repairRegions：孤立行吸收 + 重叠区域合并
    ├── assign/
    │   ├── assign.ts       # buildLines（上/下标挂回基线行）+ mergeParagraphs（行距/栏间/段首缩进多判据）+ assignItems（排他认领）
    │   └── cross-merge.ts  # canMergeTailHead（五闸门链式续接）+ groupColumns（几何扫描向上探找右栏）+ planSamePageMerges + pageHeadTail
    ├── translate/
    │   ├── llm_trans.ts    # OpenAI 兼容调用 + %% 分段 join/split + 标题块特殊处理
    │   ├── scheduler.ts    # 页间闸门（maxConcurrentPages）+ 页内全并行 + 在途去重
    │   ├── cross-page.ts   # 跨页尾段挂起状态机（decideCrossPage：pending/headMerge/releasePrev/newPending）
    │   ├── sentence-split.ts  # splitBySentences + splitByRatio（切句辅助）
    │   └── microsoft.ts    # Microsoft Edge 翻译端点辅助
    └── viewer/
        ├── pagehost.ts     # PageHost 三层（canvas / selectLayer / transLayer）
        ├── render-view.ts  # clusterParas（簇划分：空隙 + 横向相交 + soloCluster）+ renderBlocks（建簇盒）+ distributeTexts / distributeTextsSkip（回填）+ applyTextZOrder
        ├── trans-units.ts  # buildTranslationUnits：把 views + groups + 跨页裁定拼装成 Unit[]（不重不漏）
        ├── cluster-layout.ts  # solveClusterLayout（三步求解）+ unifyScales（同页相似段共享最小档）
        ├── fit-text.ts     # splitByCapacity（按盒容量分配译文：字符级二分 + 切点软化 + 后盒硬容量）
        ├── fit-line-height.ts  # fitLineHeight（行高自适应：只增不减 + 步长跳测）
        ├── obstacles.ts    # availableHeightFor（盒向下可吃到的总高 = 原位高 + 到最近障碍的距离）
        ├── coords-rot.ts   # regionToUnrotated（显示→未旋转帧）+ blockDisplayTransform（未旋转帧→CSS rotate）
        ├── text-metrics.ts # 唯一估算口径：charWidth / rowsNeeded / contentSize
        ├── mixed-text.ts   # parseMixed（$...$ / $$...$$）+ fillMixedText（文本节点 + KaTeX DOM）
        ├── debug-panel.ts  # 调试面板（类别复选 + 置信度滑杆 + 性能显示 + JSON 导出）
        ├── apply-cluster-layout.ts  # 求解结果写入 DOM（height / fontSize / lineHeight / overflow 标记）
        └── env.ts          # extUrl（chrome.runtime.getURL 兜底 location.origin）

public/
├── ort-wasm-*.{wasm,mjs}   # onnxruntime-web JSEP 资源
├── pdf.worker.min.mjs      # pdf.js worker
├── cmaps/                  # PDF CMap 资源
├── standard_fonts/         # Foxit + Liberation 标准字体
├── cv.png                  # 测试图
└── icon-*.png              # 扩展图标

test/
├── serve.py                # 127.0.0.1:8899 静态服务器（COOP/COEP）
├── dev.sh                  # 一键调试脚本
├── verify-acceptance.mjs   # CDP 验收：覆盖率 ≥ 0.98 / keep 区域零译文块 / keep 区域像素差 ≤ 2%
├── verify-bitmap.mjs       # 位图采样验收
├── cdp-*.mjs               # 各类 CDP 调试脚本
├── diag-*.mjs              # 诊断脚本（节点/样式/公式/旋转…）
├── screenshot-*.png         # 验收截图
├── single-column.pdf       # 单栏测试
└── two-column.pdf          # 双栏测试

docs/
├── inplace-design.md
├── bug-log-left-page-blank.md
├── meowtabby-integration.md
├── superpowers/specs/      # 设计规格（跨栏合并 / 旋转坐标 / 排版求解…）
└── superpowers/plans/      # 实施计划（逐任务落地）
```

---

## 4. 核心数据流

### 4.1 坐标体系

整条管线在**三个坐标系**之间反复变换：

| 坐标系     | 约定                 | 使用者                                                     |
| ---------- | -------------------- | ---------------------------------------------------------- |
| PDF y-up   | y=底、h=高           | PdfTextItem（pdf.js transform[5] 是基线，ASCENT=0.8 上移） |
| CSS y-down | y=顶                 | Region（模型输出）、canvas 位图、overlay 调试叠加层        |
| 未旋转帧   | 旋转 90/270 时轴交换 | 旋转页的管线内部（coords-rot.ts）                          |

翻转函数 `flipRegionY` / `regionToUnrotated` / `blockDisplayTransform` 是变换枢纽。`main.ts` 的 applyPage 里根据旋转状态选择路径。

### 4.2 页面管线时序

```
IntersectionObserver 触发（视口 ±300px 内）
  → 串行排队：queue.then(() => processPage(st))

processPage:
  ① renderPageToCanvas → 左 canvas 位图（RENDER_SCALE = dpr×2，上限 3）
  ② 右 canvas = drawImage(左 canvas)，像素级一致
  ③ getTextItems → PdfTextItem[]
  ④ runner.predictPage → Region[]（**缓存，永不重推理**）
  ⑤ applyPage(st)

applyPage（所有逻辑，无异步）:
  ① 过滤 + 坐标变换 + repairRegions（孤立行吸收 + 重叠合并）
  ② assignItems → AssignedBlock[]（排他认领 + buildLines + mergeParagraphs）
  ③ dropKeepOverlappingParas / dropNonTextOrphans / dropFloatingParas（三道弃翻保护）
  ④ planSamePageMerges + pageHeadTail + decideCrossPage（同页合并 + 跨页裁定）
  ⑤ renderBlocks → BlockView[]（簇划分 + 建白底盒）
  ⑥ obstacleRects / clusterAvailHeight（障碍表，给"向下吃空间"用）
  ⑦ buildTranslationUnits → Unit[]（**不重不漏**拼装请求 + 回填闭包）
  ⑧ fillTranslations → scheduler.fill（翻译请求）→ distributeTexts / fillMixedText（回填）
     → solveClusterLayout（三步求解）→ applyClusterLayout（写 DOM）
  ⑨ applyTextZOrder + collectClusterMetrics（验收采集）
```

### 4.3 翻译单元（Unit）的四种类型

`buildTranslationUnits` 把一页拼装成四类单元，保证**每段原文在所有 Unit 的 request 中恰好出现一次**：

| 类型       | 来源                                | 送翻                                                   | 回填                         |
| ---------- | ----------------------------------- | ------------------------------------------------------ | ---------------------------- |
| `view`     | 普通 translate 块（剔除合并成员后） | 段用 %% 连接                                           | distributeTextsSkip → 各簇盒 |
| `title`    | title 类块                          | 整条（joinPlain）                                      | 整块落进唯一簇               |
| `group`    | 页内合并组 + 跨页合并组             | 整条（joinPlain），译文按容量 splitByCapacity 拆回各盒 | 各 part 盒（强制涂白）       |
| `released` | 解除挂起的上页尾段                  | 单段（joinPlain）                                      | 回填原挂起段盒（强制涂白）   |

构建顺序：普通块 → 页内组 → 跨页组 → released。后构建的单元会先打 skip（标记前一单元要剔除的段）。

**回退语义**：任一合并单元有 part 解析不到视图 → 整组放弃且不打任何 skip，成员段回原块 Unit 送翻。

### 4.4 翻译调度（scheduler）

```
fill(texts):
  acquirePage()  ← 页间闸门（maxConcurrentPages，默认 2）
  missing = texts.filter(未缓存且未在途)  ← 在途去重
  Promise.all(missing.map(request))  ← 页内全并行
  releasePage()
```

成功入 cache，失败不入缓存（后续重渲染自动重试）。

### 4.5 排版三步求解（cluster-layout.ts）

统一入口 `solveClusterLayout`，三阶段依次执行：

| 阶段         | 操作                                                                                                         | 约束                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| 阶段 1：字号 | 从 `startScale`（合并组由 splitByCapacity 给，普通块 = 1）开始，档位表 `[1, 0.9, 0.81, 0.73, 0.66]` 只降不放 | 内容高 ≤ availHeight                             |
| 阶段 2：行高 | 只增不减。小增量（< 0.3）0.1 步长步进；大增量跳测候选 [0, n-0.1, n, n+0.1]                                   | 目标 = 填满原位高（minHeight），不是 availHeight |
| 阶段 3：盒高 | 内容 > availHeight → overflow，盒高锁 availHeight，DOM 层挂滚动兜底；否则 `max(minHeight, 内容高)`           | 盒高恒 ≤ availHeight（结构不变量）               |

**同页字号统一**：`unifyScales` 对字号（容差 15%）和盒宽（容差 20%）接近的簇取最小档，只降不升，然后对每个被改写的簇**重跑求解**（档位变了行高和盒高也要跟着重算）。

### 4.6 簇划分（clusterParas）

一个版面块 → 若干"簇"：空隙 `≤ max(3×段落高中位, 24px)` 且横向相交的段落共簇。白底盒建在簇级，而非块级。原因：块级盒容易因段落散开而变成跨页巨盒（实测 abandon 框文字被兜底块收编后盒高 714px，盖掉半页）。

`soloCluster = true` 的段落强制独占一簇——两种场景：

1. 跨栏合并组成员（合并单元统一回填，不能与邻段共享盒）
2. 跨页 headMerge 的头段（会被整盒替换，不能清邻段译文）

### 4.7 跨栏合并判定（cross-merge.ts）

**五闸门链式续接**，全部从文本层特征判定：

1. 尾行顶满（右缘缺 ≤ 1 行高）
2. 尾行无句末标点（中英文句号/问叹号/分号/冒号/省略号 + 后置引号括号）
3. 头行顶格（左缘缺 ≤ max(0.5 行高, 3px)）
4. 两块宽度差 < 较窄块宽度（排除图注/横幅）
5. 头行首字符非数字/大写句/项目符号

**栏归组**（groupColumns）用**几何扫描**而非剖面找空隙：从当前栏最下端块的右缘出发，沿栏间空白带向上探，碰到任何框（正文或图像）就折返，然后在畅通高度带内向右找第一个"非图注/横幅"的未分配块。比剖面法更健壮——跨栏图注不会让整页退化成单栏。

### 4.8 跨页合并状态机（cross-page.ts）

三态流转：

```
pendingTail（上页挂起的候选尾段）
  ↓ 下页渲染
decideCrossPage:
  ├─ pending + head 过五闸门 → headMerge（两段合一条送翻，回填两页的簇盒）
  ├─ 否则 → releasePrev（旧挂起解除，独立补翻；如果新 tail 过闸门则 newPending = tail）
  └─ 末页 → 不挂新尾
```

挂起尾段渲染为**透明占位盒**（background:transparent），照常参与分簇建盒。合并命中后由跨页组单元回填并强制涂白。

### 4.9 合并组容量分配（fit-text.ts）

`splitByCapacity` 按盒的可用容量切分译文：

1. 档位循环（SCALE_STEPS）
2. 每档用 `maxChars`（二分折行，逐盒算可容纳字符数）
3. `allocateChars`（前盒优先：每盒保底 MIN_CHARS=4，前盒吃满 caps，末盒吸收剩余）
4. 末盒校验硬容量；通过 → `softenCutPoints`（最后一个切点在 6 字符窗口内向左回退到最近标点/空格）
5. 全档失败 → 比例兜底（每盒轻微溢出，盒内滚动）

### 4.10 混排译文渲染（mixed-text.ts）

parseMixed 把译文拆成 text / formula token 序列，纯函数单遍状态机。`$...$` 行内公式（不含换行），`$$...$$` 块级公式（可跨行），`\$` 是字面美元符。渲染层文本走 `createTextNode`，公式走 KaTeX DOM（`throwOnError:false`，坏 LaTeX 退化为原始串）。**全程不拼 innerHTML**。

### 4.11 文字归属（assign.ts）

排他认领顺序是硬约束：

1. 题注原框先认领（同类按置信度降序）
2. keep 原框认领图、表、独立公式内文字
3. 其他 translate 原框按置信度降序认领
4. keep 四边外扩 6px，只认领仍无主的图边文字
5. skip(abandon) 区域最后认领（模型偶发把大段正文误标为 abandon，排在最后可保证正文先被 translate 抢走）

未落入任何区域的 item → 兜底 translate 块（region=null）。

### 4.12 弃翻保护（三道）

只作用于**边角文字块**（兜底块 / skip 块的段落），正式 translate 区域的段落不受约束：

| 保护                     | 判定                                      | 原因                             |
| ------------------------ | ----------------------------------------- | -------------------------------- |
| dropKeepOverlappingParas | 与 keep 区域 ≥3px 实质重叠                | 模型漏检的表格文字，宁保图不硬翻 |
| dropNonTextOrphans       | 纯数字/符号（无字母无汉字）               | 页码/公式编号，不生成白底盖正文  |
| dropFloatingParas        | Δy > 2.5×行距 且 碎片化（≤8字 或 纯符号） | 页码/页边标记，不送翻译不渲染    |

### 4.13 段落合并判据（mergeParagraphs）

四段同时满足其一即切段：

- `yBreak`：行距 > `max(1.35×行距基准, 1.2×行高)`
- `xBreak`：跨行间隙 > `SPLIT_GAP=8px`（仅对"不同 y 的行"，同视觉行无条件放行）
- `paragraphStart`：上一行是段末短行（右缘缺 > 1.5 行高）**且** 本行首缩进 ≥ 0.8×行高（段首特征）
- `gapHitsBarrier`：行间间隙带与 keep 区域（图/表/公式）重叠

行距基准优先用**页级估计**（`estimateBaseLeading`：各 translate 区域内部行距中位数的中位数），不用整页相邻行差（跨框大间隙会抬高基准）。

---

## 5. 模型与推理

### 5.1 模型加载

```
modelUrl（?model=）
  ↓ Cache API "layout-model" 缓存（以文件名 + url 为键）
  ↓ hf.co（15s 超时）
  ↓ hf-mirror 自动回退
  ↓ InferenceSession.create：webgpu EP 优先，失败回 wasm EP
  ↓ 类别名从 session.metadata.names 自动发现（兜底 MODEL_CLASSES）
```

ORT wasm 资源显式指到 `chrome.runtime.getURL("/")` 或 `location.origin + "/"`（否则打包后找不到）。固定单线程（多线程 pthread 在 JSEP 下会让 session.create 永久挂起）。加速走 WebGPU EP。

### 5.2 预处理

letterbox 与 BabelDOC / pdf2zh 一致：等比缩放 + stride=32 对齐 + 灰 114 补边。输入 `[1, 3, 1024, 1024]` RGB/255。`model-runner.ts` 的 `buildPageInput` 用 OffscreenCanvas 精确绘制 `round(cssW×scale) × round(cssH×scale)`，锚定 pad 中心——**不按 resizedW/H 拉伸**（有效 scale 必须与 scaleBoxes 除数一致）。

### 5.3 解码

兼容三种 YOLO 输出布局：

- 行主序端到端 `[1, N, 6]`（x1,y1,x2,y2,conf,cls）——DocLayout-YOLO 实测即此
- 端到端头 `[1, 6, N]`
- 传统头 `[1, 4+nc, N]`（需 NMS）

置信度阈值 0.35。

### 5.4 模型规格

| 属性      | 值                                                                |
| --------- | ----------------------------------------------------------------- |
| 名称      | doclayout_yolo_docstructbench_imgsz1024                           |
| 类别数    | 10（DocStructBench）                                              |
| 输入尺寸  | 1024×1024                                                         |
| 许可      | AGPL-3.0（实验期无碍；商业化前需评估换 PP-DocLayout，Apache-2.0） |
| ONNX 大小 | 71.8MB                                                            |
| 推理耗时  | 5-6s/页（WASM，无 WebGPU）                                        |
| 优化路径  | JSEP WebGPU 构建 / 缩小输入 / 换 PP-DocLayout-M（22.6MB 纯卷积）  |

---

## 6. 验收指标（数值化）

`test/verify-acceptance.mjs` 用有头 Chrome + CDP 逐页滚动触发懒加载，采集三个**结构不变量**：

| 指标            | 阈值   | 含义                                                       |
| --------------- | ------ | ---------------------------------------------------------- |
| 覆盖率          | ≥ 0.98 | 翻译段落文字 / 可翻译文字总长（分母剔除 keep 消费 + 弃翻） |
| keep 区域译文块 | 0      | 图/表/公式上不允许出现覆盖（结构性要求）                   |
| keep 区域像素差 | ≤ 2%   | 右页 canvas 位图采样（与左页对比）                         |

DOM 采集的簇盒不变量（main.ts 的 collectClusterMetrics）：

| 指标                | 期望 | 含义                                       |
| ------------------- | ---- | ------------------------------------------ |
| clustersBeyondAvail | 0    | 盒高越过障碍边界（求解器结构不变量）       |
| clustersOvergrown   | 0    | 实测高 > 原位高 + 1 行（排版兜底前的症状） |

最近一次全量验收（5 份论文：CVPR 双栏 / arXiv 单栏 / 单页-公式 / Non-local / 污水检测混合旋转）全部通过。

---

## 7. 开发与调试

### 7.1 一键调试

```bash
pnpm dev:debug
```

做四件事：① `pnpm build` 编译 → ② 模型和测试 PDF 拷进 `.output/chrome-mv3/` → ③ 后台启动静态服务器（nohup python3 test/serve.py，127.0.0.1:8899，COOP/COEP）→ ④ 打印可点击调试 URL。

关调试：`lsof -ti :8899 | xargs kill`

### 7.2 调试面板

页面左上角"高级选项"按钮 → 浮出调试面板（第一等公民）：

| 控件                   | 作用                                    |
| ---------------------- | --------------------------------------- |
| 类别复选（带颜色）     | 只显示/使用某一类区域框                 |
| 置信度滑杆             | 左松右严，只重过滤不重推理              |
| 性能显示               | 当前页 / 推理耗时 / 后端 / 模型加载耗时 |
| 导出JSON               | 当前页区域框+类别+置信度复制剪贴板      |
| 文字归属（左页叠加层） | 文字 item 着色显示所属区域              |

推理结果**永不重跑**——过滤条件变化只重算过滤/归属/渲染（`panel.onFilterChange`）。

### 7.3 URL 参数

```
viewer.html?url=<pdf>
  &model=<可选 onnx 覆盖地址>
  &to=zh
  &from=en
  &llm_trans_url=<翻译后端覆盖>
  &llm_trans_key=<API key 覆盖>
  &llm_trans_model=<模型名覆盖>
```

### 7.4 常用命令

| 命令              | 作用                                                            |
| ----------------- | --------------------------------------------------------------- |
| `pnpm install`    | 依赖安装                                                        |
| `pnpm build`      | 生产构建 → `.output/chrome-mv3/`                                |
| `pnpm test`       | vitest（25 通过 + 2 模型集成测试默认跳过；RUN_MODEL_IT=1 开启） |
| `pnpm type-check` | tsc --noEmit                                                    |

加载扩展：`chrome://extensions` → 开发者模式 → 加载已解压 → `.output/chrome-mv3/`。

### 7.5 验收自己的 PDF

```bash
cp 你的.pdf .output/chrome-mv3/
node test/verify-acceptance.mjs "http://127.0.0.1:8899/viewer.html?url=..." [截图路径]
```

---

## 8. 设计演进线索

以下是本项目从 v0 到最终版的关键设计决策（来自 docs/superpowers/plans/ + 代码注释），按时间顺序：

| 时间       | 决策                                                                | 背景                                                                   |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 2026-09-07 | 版面模型方案立项                                                    | 与几何启发式方案并行实验                                               |
| 2026-09-09 | DocLayout-YOLO 选定（pdf2zh/BabelDOC 同款），输入 1024，置信度 0.35 | 10 类覆盖学术论文主要结构                                              |
| 2026-09-12 | 旋转页坐标：未旋转帧方案，管线内部走未旋转帧、渲染时 CSS rotate     | /Rotate 90/180/270 页面的文本层坐标与显示空间不一致                    |
| 2026-09-14 | 段落合并改用"文档典型行距"（页级估计），不再用框内中位数            | 框内只有 2-3 行时中位数不稳，同一视觉行碎片会把它拉到 0                |
| 2026-09-14 | 簇划分替代块级盒：白底落簇级而非块级                                | abandon 框文字被兜底收编后块盒高 714px，盖半页                         |
| 2026-09-14 | 排他认领顺序：keep→translate 按 conf 降序→skip 最后                 | 模型偶发把大段正文误标 abandon，排最后可让 translate 抢走              |
| 2026-09-14 | 跨栏合并五闸门                                                      | 全部从文本层特征判定，避免误合图注/横幅                                |
| 2026-09-15 | 栏归组换几何扫描（向上探 + 向右找）                                 | 剖面法被跨栏图注污染，整页退化成单栏                                   |
| 2026-09-16 | 翻译单元（Unit）模式替代原"按块回填"                                | 保证每段原文恰好送翻一次，合并组成员从原块剔除、由组单元负责           |
| 2026-09-16 | 挂起尾段改"透明占位盒"语义（原先隐藏不建盒）                        | 回填静默落空——合并命中时需要有盒可写                                   |
| 2026-09-16 | fillBlockText → fillMixedText（支持 $...$ / $$...$$ LaTeX）         | 翻译提示词已要求模型输出 LaTeX，需要渲染层配合                         |
| 2026-09-16 | 翻译调度：页间闸门（≤2 页）+ 页内全并行 + 在途去重                  | 多页同时需要页眉/版权行等跨页重复时只发一条                            |
| 2026-09-17 | 合并组容量分配：字符级二分替代句子级切分                            | 句子级有"整句推走"效应，前盒留大片空白                                 |
| 2026-09-17 | 排版三步求解器统一入口                                              | 三类块（普通/标题/合并组）各有独立字号/行高/盒高逻辑，统一到一个求解器 |
| 2026-09-17 | 切点软化（最后一个切点在 6 字符窗口内回退到最近标点/空格）          | 跨栏/跨页断点处切在单词中间会出 "transla\|tion"                        |
| 2026-09-17 | 障碍表（obstacleRects）+ 可用高注入 Unit                            | 合并组"前盒向下吃到障碍"的空间需要从障碍表实时计算                     |
| 2026-09-17 | 同页字号统一（unifyScales）                                         | 相似段落共享最小档                                                     |

---

## 9. 已知限制

| 限制                         | 影响                                                     | 可能优化                                           |
| ---------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| WASM 推理 5-6s/页            | 长 PDF 首屏慢                                            | JSEP WebGPU / PP-DocLayout-M（22.6MB）             |
| 扫描件（无文字层）不支持     | 整体不适用                                               |                                                    |
| 一个版面块 = 一次翻译请求    | 模型不守 %% 约定时丢段落结构                             | 译文缓存 + 容错切回整条                            |
| 不做跨栏判定                 | 相信 YOLO 分块；若模型把两栏框进同一个框，译文块横跨栏沟 | 框宽门控（兜底思路见 错误调试日记.md，当前不实现） |
| ORT wasmPaths 全局可变       | 多 tab 可能冲突                                          | 独立 InferenceSession 实例                         |
| DEFAULT_API_KEY 硬编码在源码 | 正式分发前必须移除                                       | URL 参数 / 环境注入                                |

---

## 10. 与 MeowTabby 主项目的关系

- **MeowTabby/AGENTS.md** 明确标注：本项目是**版面模型方案**的实验分支，最终决定是否合并进 MeowTabby 主仓库。
- 本项目的翻译后端（llm_trans）默认指向 DeepSeek v4 flash，与 MeowTabby 主项目的 billing-backend（火山引擎 DeepSeek API）同源。
- 本项目的 `%%` 分段约定（`BATCH_SEPARATOR`）直接对齐 MeowTabby 的批量翻译规则（`src/utils/billing/generate.ts`）。
- 合并后，本项目的 layout + assign + translate + viewer 四个模块将作为独立子系统接入 MeowTabby 的 viewer 入口。

---

## 附录 A：数据类型速查

```
PdfTextItem      { str, x, y(ASCENT上移后), w, h, fontName }     PDF y-up
Region           { x1, y1, x2, y2, className, conf, behavior }    CSS y-down
Paragraph        { x, y(=底), w, h, text, lineCount, fontSize, lines, soloCluster? }  y-up
AssignedBlock    { region|null, behavior, paras[] }
BlockCluster     { box, idx[], geo(y-up DisplayBox), fontSize }
BlockView        { blockId, paras[], clusters[], noSegment, el }
MergeGroup       { parts: ParaPartRef[] }
CrossParaRef     { pageIndex, blockId, paraIdx, text, lines, w, fontSize }
Unit             { request, kind, fill(), layoutTargets[], groupBoxes?, refit? }
ClusterLayoutTarget { box, minHeight, availHeight, width, baseFontSize }
```

## 附录 B：URL 参数速查

```
url=<pdf 地址>&model=<可选 onnx>&to=zh&from=en
  &llm_trans_url=<翻译后端 base>&llm_trans_key=<API key>&llm_trans_model=<模型名>
```

## 附录 C：关键阈值常量

| 常量                 | 值                         | 位置               | 含义                                |
| -------------------- | -------------------------- | ------------------ | ----------------------------------- |
| RENDER_SCALE         | min(dpr×2, 3)              | render.ts          | canvas 渲染倍率                     |
| INPUT_SIZE           | 1024                       | model-runner.ts    | 模型输入尺寸                        |
| STRIDE               | 32                         | model-runner.ts    | letterbox stride 对齐               |
| CONF_THRESHOLD       | 0.35                       | model-runner.ts    | 置信度过滤                          |
| KEEP_MARGIN          | 6                          | assign.ts          | keep 区域外扩（图内文字不翻）       |
| SUB_SCALE            | 0.8                        | assign.ts          | 上/下标判定（h < 0.8×正文高）       |
| SUB_HANG             | 0.55                       | assign.ts          | 上/下标悬挂距离（×行高）            |
| CLUSTER_GAP          | 24                         | render-view.ts     | 簇划分空隙（与 3×段落高中位取 max） |
| LINE_HEIGHT          | 1.3                        | text-metrics.ts    | 单行高系数                          |
| MIN_CHARS            | 4                          | fit-text.ts        | 合并组每盒保底字符数                |
| SOFTEN_WINDOW        | 6                          | fit-text.ts        | 切点软化窗口（字符）                |
| LH_STEP              | 0.1                        | fit-line-height.ts | 行高步长                            |
| LH_JUMP_LIMIT        | 0.3                        | fit-line-height.ts | 小/大增量分界                       |
| LH_INCREASE_CAP      | 50                         | fit-line-height.ts | 行高增量护栏                        |
| LH_MIN_INCREASE      | 0.1                        | fit-line-height.ts | 增量太小不动                        |
| COL_MIN_LINES        | 2                          | cross-merge.ts     | 栏归组最少行数（过滤页眉/作者行）   |
| COL_GAP_RATIO        | 0.03                       | cross-merge.ts     | 栏间空隙宽度下限（页宽比例）        |
| ABSORB_GAP           | 25                         | repair.ts          | 孤立行吸收间隙上限                  |
| MAX_ABSORB_CHARS     | 10                         | repair.ts          | 孤立行吸收字符数上限                |
| SCALE_STEPS          | [1, 0.9, 0.81, 0.73, 0.66] | fit-text.ts        | 缩字号档位                          |
| MAX_CONCURRENT_PAGES | 2                          | main.ts            | 翻译页间并发上限                    |

## 附录 D：验收脚本说明

`verify-acceptance.mjs` 的工作流：

1. 有头 Chrome + CDP 打开 viewer URL
2. 逐页滚动触发懒渲染，等待推理与翻译完成
3. 采集 `window.__acceptance`（main.ts 在初始化时挂）
4. 逐页检查 coverage ≥ 0.98 / keep 区域零译文块 / keep 区域像素差 ≤ 2%
5. 可选截图（CDP 对 CSS 缩放 canvas 有微缩点阵失真，截图仅供人看，数值为准）
