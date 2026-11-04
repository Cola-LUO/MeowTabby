# web_pdf_trans 归档（PDF 版面模型翻译实验）

> 本文件是 `web_pdf_trans/` 独立项目的合并归档。该项目完成后，PDF 翻译功能后续在 MeowTabby 主仓库内开发。以下内容保留实验过程的完整技术文档，供未来整合参考。

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

---

## 3. 模块职责

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
    │   ├── model-runner.ts # LayoutModelRunner：ORT 会话（webgpu→wasm 回退）+ Cache API 缓存 + hf-mirror 回退
    │   ├── preprocess.ts   # letterbox（与 BabelDOC 一致：等比缩放 + stride=32 对齐 + 灰 114 补边）
    │   ├── decode.ts       # 兼容三种 YOLO 输出布局的解码 + NMS + 坐标缩放 + 类别行为映射
    │   └── repair.ts       # repairRegions：孤立行吸收 + 重叠区域合并
    ├── assign/
    │   ├── assign.ts       # buildLines（上/下标挂回基线行）+ mergeParagraphs（多判据切段）+ assignItems（排他认领）
    │   └── cross-merge.ts  # canMergeTailHead（五闸门）+ groupColumns（几何扫描找右栏）+ planSamePageMerges + pageHeadTail
    ├── translate/
    │   ├── llm_trans.ts    # OpenAI 兼容调用 + %% 分段 join/split + 标题块特殊处理
    │   ├── scheduler.ts    # 页间闸门（≤2 页）+ 页内全并行 + 在途去重
    │   ├── cross-page.ts   # 跨页尾段挂起状态机（pending/headMerge/releasePrev/newPending）
    │   ├── sentence-split.ts  # splitBySentences + splitByRatio（切句辅助）
    │   └── microsoft.ts    # Microsoft Edge 翻译端点辅助
    └── viewer/
        ├── pagehost.ts     # PageHost 三层（canvas / selectLayer / transLayer）
        ├── render-view.ts  # clusterParas + renderBlocks + distributeTexts + applyTextZOrder
        ├── trans-units.ts  # buildTranslationUnits：把 views + groups + 跨页裁定拼装成 Unit[]（不重不漏）
        ├── cluster-layout.ts  # solveClusterLayout（三步求解）+ unifyScales（同页字号统一）
        ├── fit-text.ts     # splitByCapacity（按盒容量分配译文：字符级二分 + 切点软化）
        ├── fit-line-height.ts  # fitLineHeight（行高自适应：只增不减 + 步长跳测）
        ├── obstacles.ts    # availableHeightFor（盒向下可吃到的总高 = 原位高 + 到最近障碍的距离）
        ├── coords-rot.ts   # regionToUnrotated（显示→未旋转帧）+ blockDisplayTransform（未旋转帧→CSS rotate）
        ├── text-metrics.ts # 唯一估算口径：charWidth / rowsNeeded / contentSize
        ├── mixed-text.ts   # parseMixed + fillMixedText（$...$ / $$...$$ LaTeX 渲染，不拼 innerHTML）
        ├── debug-panel.ts  # 调试面板（类别复选 + 置信度滑杆 + 性能显示 + JSON 导出）
        └── apply-cluster-layout.ts  # 求解结果写入 DOM
```

---

## 4. 设计演进时间线

| 日期       | 决策                                        | 背景                              |
| ---------- | ------------------------------------------- | --------------------------------- |
| 2026-09-07 | 版面模型方案立项                            | 与几何启发式并行实验              |
| 2026-09-09 | DocLayout-YOLO 选定，1024 输入，置信度 0.35 | pdf2zh/BabelDOC 同款              |
| 2026-09-12 | 旋转页：未旋转帧方案                        | /Rotate 90/180/270 页面坐标不一致 |
| 2026-09-14 | 段落合并改页级行距估计                      | 框内 2-3 行中位数不稳             |
| 2026-09-14 | 簇划分替代块级盒                            | abandon 框收编后块盒高 714px      |
| 2026-09-14 | 排他认领顺序 keep→translate→skip            | 模型偶发误标 abandon 大段正文     |
| 2026-09-14 | 跨栏合并五闸门                              | 全部文本层特征判定                |
| 2026-09-15 | 栏归组换几何扫描                            | 剖面法被跨栏图注污染              |
| 2026-09-16 | Unit 模式替代按块回填                       | 每段原文恰好送翻一次              |
| 2026-09-16 | 挂起尾段改透明占位盒                        | 合并命中时需要有盒可写            |
| 2026-09-16 | fillBlockText → fillMixedText               | 翻译提示词已要求 LaTeX            |
| 2026-09-17 | splitByCapacity 字符级                      | 句子级有"整句推走"效应            |
| 2026-09-17 | solveClusterLayout 统一入口                 | 三类块各有独立逻辑                |
| 2026-09-17 | 切点软化                                    | 跨栏/跨页断点切在单词中间         |
| 2026-09-17 | obstacleRects + 可用高注入                  | 合并组前盒向下吃空间              |
| 2026-09-17 | unifyScales                                 | 相似段落共享最小档                |

---

## 5. 验收指标（数值化）

| 指标                | 阈值   | 含义                             |
| ------------------- | ------ | -------------------------------- |
| 覆盖率              | ≥ 0.98 | 翻译段落文字 / 可翻译文字总长    |
| keep 区域译文块     | 0      | 图/表/公式上不允许出现覆盖       |
| keep 区域像素差     | ≤ 2%   | 右页 canvas 与左页位图采样对比   |
| clustersBeyondAvail | 0      | 盒高越过障碍边界（求解器不变量） |

最近一次全量验收（5 份论文：CVPR 双栏 / arXiv 单栏 / 单页-公式 / Non-local / 污水检测混合旋转）全部通过。

---

## 6. 关键阈值常量速查

| 常量                 | 值                         | 位置            |
| -------------------- | -------------------------- | --------------- |
| RENDER_SCALE         | min(dpr×2, 3)              | render.ts       |
| INPUT_SIZE           | 1024                       | model-runner.ts |
| CONF_THRESHOLD       | 0.35                       | model-runner.ts |
| KEEP_MARGIN          | 6                          | assign.ts       |
| CLUSTER_GAP          | 24                         | render-view.ts  |
| LINE_HEIGHT          | 1.3                        | text-metrics.ts |
| MIN_CHARS            | 4                          | fit-text.ts     |
| SOFTEN_WINDOW        | 6                          | fit-text.ts     |
| SCALE_STEPS          | [1, 0.9, 0.81, 0.73, 0.66] | fit-text.ts     |
| MAX_CONCURRENT_PAGES | 2                          | main.ts         |

---

## 7. 已知限制（合并前需评估）

| 限制                      | 影响                         |
| ------------------------- | ---------------------------- |
| WASM 推理 5-6s/页         | 长 PDF 首屏慢                |
| 扫描件不支持              | 无文字层整体不适用           |
| 一个版面块 = 一次翻译请求 | 模型不守 %% 约定时丢段落结构 |
| ORT wasmPaths 全局可变    | 多 tab 可能冲突              |
| DEFAULT_API_KEY 硬编码    | 正式分发前需移除             |

---

## 8. 未来在 MeowTabby 内的整合入口

- PDF viewer 可以作为 MeowTabby 的新 entrypoint（`src/entrypoints/pdf-viewer/`），复用现有 billing 托管通道做翻译（`src/utils/billing/generate.ts` + SSE 流）
- 版面模型加载（LayoutModelRunner）需要评估：浏览器扩展 context 下 Cache API / chrome.storage 可用性；模型权重随包分发 vs. URL 覆盖
- 双栏渲染层（viewer 模块的 cluster-layout / fit-text / mixed-text 等）与现有 background/content script 架构的对接方式待规划
- 测试：`pnpm test` 验证通过的模块可以独立抽离

---

_本文档归档自已完成的 web_pdf_trans 独立项目（2026-09-07 至 2026-09-17，约 10 个工作日）_
