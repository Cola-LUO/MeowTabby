# Inline Atoms 公式保留移植实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把上游 read-frog PR #2155（双语翻译保留行内公式：MathML/KaTeX/MathJax/Wikipedia）移植进 MeowTabby。

**Architecture:** 公式元素作为"inline atom"：抽取时以 `{{n}}` 占位符替换发给翻译服务，译文回来后在占位符位置回填原公式的净化克隆；后台对含占位符的译文做缓存审计（丢失/伪造/重复占位符则照常渲染但不落缓存）。无公式的段落字节级等同旧路径。

**Tech Stack:** WXT + React 19 + TypeScript + vitest（Node/jsdom）。

**Spec:** 上游实现即规格。上游参考仓库（1.46.8，含本 PR）在磁盘 `/Users/Luo_F/vs_code/github克隆到本地/read-frog`（下称 `$UP`），MeowTabby 仓库在 `/Users/Luo_F/vs_code/MeowTabby`（下称 `$MT`）。移植 = 从 `$UP` 对应文件取测试与实现，适配 MeowTabby 分叉点。

## Global Constraints

- 只在 `$MT` 新分支 `feat-inline-formula-atoms` 上工作（基于当前 main `189bd62`）；`$UP` 只读。
- commit message 用中文，type/scope 前缀保留英文，如 `feat(translate): 双语翻译保留行内公式（token 模块）`。
- 测试命令：`SKIP_FREE_API=true pnpm vitest run <单文件>`（多目录会挂 watch，禁用）；终验 `SKIP_FREE_API=true pnpm test` + `pnpm lint`。
- MeowTabby CSS 类名未改品牌，仍是 `read-frog-*`；`INLINE_ATOM_CLASS = "read-frog-inline-atom"` 原样使用。
- `$MT/src/utils/constants/prompt.ts`、`$MT/src/utils/site-rules/effective.ts` 与上游 1.46.8 逐字节一致，无需改动。
- token 语法唯一正则 `{{n}}`（数字、无内空格）：编码、解码、`nextFreeInlineAtomIndex`、`auditInlineAtomTokens` 四处必须共用 `INLINE_ATOM_TOKEN_STRICT_RE`（上游注释有完整不变量说明）。
- rules.json 是数据文件，编译器抓不到引用错误；MeowTabby 的 `video-title` injectedCss（`white-space:unset`）是自有改动，必须保留。
- `translation-modes.ts` 中上游另一处重构（`isSystemProviderRef`/`canSplitGiantWithoutStrandingOwnText`）**不属于本 PR，不移植**；MeowTabby 保留自己的 provider API。
- `translation-queues.ts` 上游在 fork 点之后做过 hosted-routing 大重构，**只能手工适配 PR hunk**，不得整文件复制。

### Task 1: token 协议模块 `inline-atom-tokens.ts`（DOM-free）

**Files:**

- Create: `src/utils/host/translate/inline-atom-tokens.ts`（复制 `$UP` 同路径，151 行，纯文本模块，无适配点）
- Test: `src/utils/host/translate/__tests__/inline-atom-tokens.test.ts`（复制 `$UP` 同路径，143 行）

**Interfaces（产出）:** `INLINE_ATOM_TOKEN_DELIMITERS`、`INLINE_ATOM_TOKEN_STRICT_RE`、`encodeInlineAtomToken(index: number): string`、`hasInlineAtomTokens(text: string): boolean`、`nextFreeInlineAtomIndex(text: string): number`、`decodeInlineAtomTokens(text): DecodedInlineAtomPart[]`、`auditInlineAtomTokens(source, output): { ok, missing, unknown, duplicates }`、`INLINE_ATOM_TOKEN_SYSTEM_PROMPT`。

- [ ] Step 1: 建分支 `git switch -c feat-inline-formula-atoms`；复制 `$UP` 两个文件到 `$MT` 对应路径
- [ ] Step 2: `SKIP_FREE_API=true pnpm vitest run src/utils/host/translate/__tests__/inline-atom-tokens.test.ts` → PASS（模块与测试同源复制，直接通过）
- [ ] Step 3: `git add` 两文件，commit `feat(translate): 新增行内原子占位符 token 协议模块`

### Task 2: site-rules 类型 + resolver 折叠 `atomSelector`

**Files:**

- Modify: `src/types/config/site-rules.ts`（在 `preserveTextSelectors.remove` 之后插入 atomSelectors 三字段，照抄 `$UP` 46-52 行注释与定义）
- Modify: `src/utils/site-rules/resolve.ts`（照抄 `$UP`：`EffectiveSiteRule` 加 `atomSelector: string | null`、默认值 `atomSelector: null`、抽出 `mergeSelectorDeltaSet` 返回 Set、`mergeSelectorDelta` 变薄、resolve 处 `preserveTextSelector = joinSelectors([...preserveTextSelectors, ...atomSelectors])` 且 `atomSelector = joinSelectors(atomSelectors)`）
- Test: `src/utils/site-rules/__tests__/resolve.test.ts`（把 `$UP` 版本 diff 出的 atom 相关新增 describe/it 移植过来）

**Interfaces（产出）:** `getEffectiveSiteRule(...)` 返回值多出 `atomSelector: string | null`；atom 选择器同时折入 `preserveTextSelector`（这使 walk 行为自动阻断，filter 不用改 walk 逻辑）。

- [ ] Step 1: 先移植测试（从 `$UP/src/utils/site-rules/__tests__/resolve.test.ts` 取 atom 相关用例）
- [ ] Step 2: `SKIP_FREE_API=true pnpm vitest run src/utils/site-rules/__tests__/resolve.test.ts` → FAIL
- [ ] Step 3: 改 `site-rules.ts` + `resolve.ts`（以 `$UP` 版本为准逐段适配；注意 `$MT` 版本目前只有 `mergeSelectorDelta` 无 Set 版）
- [ ] Step 4: 复跑测试 → PASS
- [ ] Step 5: commit `feat(site-rules): 站点规则支持 atomSelectors 并折叠进 preserveTextSelector`

### Task 3: filter 谓词 + traversal `replaceElement` 钩子

**Files:**

- Modify: `src/utils/constants/dom-labels.ts`（在 `NOTRANSLATE_CLASS` 后插入 `INLINE_ATOM_CLASS` 常量，照抄 `$UP`）
- Modify: `src/utils/host/dom/filter.ts`（在 `isSiteRulePreserveTextElement` 后加 `isSiteRuleAtomElement` 与 `isInlineAtomElement`，照抄 `$UP` 195-212 行；注意 `$MT` 文件其余部分勿动）
- Modify: `src/utils/host/dom/traversal.ts`（`extractTextContent` 加 `options?: ExtractTextContentOptions` 第三参；`replaceElement` 钩子插在 wrapper 守卫后、dont-walk 守卫前——位置是 load-bearing，照抄 `$UP`）
- Test: `src/utils/host/dom/__tests__/filter.test.ts`、`src/utils/host/dom/__tests__/traversal.test.ts`（移植 `$UP` 对应新增用例：atomSelectors 阻断 walk、原生 math 根为原子、remove 关闭原子；replaceElement 四个用例）

**Interfaces（产出）:** `isInlineAtomElement(element, config): boolean`；`extractTextContent(node, config, options?)`。

- [ ] Step 1: 移植两组测试
- [ ] Step 2: 复跑两测试文件 → FAIL
- [ ] Step 3: 实施 dom-labels/filter/traversal 改动
- [ ] Step 4: 复跑 → PASS
- [ ] Step 5: commit `feat(translate): DOM 过滤器识别行内原子，抽取支持 replaceElement 钩子`

### Task 4: 原子核心模块 `dom/inline-atoms.ts`

**Files:**

- Create: `src/utils/host/translate/dom/inline-atoms.ts`（复制 `$UP`，297 行；imports 路径逐字节一致，无需适配）
- Test: `src/utils/host/translate/dom/__tests__/inline-atoms.test.ts`（复制 `$UP`，407 行，含六种渲染器真实 DOM 样例）

**Interfaces（产出）:** `InlineAtomExtraction { filterText, requestText, atoms, baseIndex, hasProse }`、`isRenderableInlineAtom`、`extractInlineAtomText(nodes, config)`、`sanitizeInlineAtomClone(source)`、`renderInlineAtomTranslation(container, translatedText, extraction)`、`containsInlineAtomOutsideWrappers(root, config)`。

- [ ] Step 1: 复制两文件
- [ ] Step 2: `SKIP_FREE_API=true pnpm vitest run src/utils/host/translate/dom/__tests__/inline-atoms.test.ts` → PASS
- [ ] Step 3: commit `feat(translate): 行内原子抽取、净化克隆与译文回填渲染`

### Task 5: 插入层 `renderTranslatedContent` 钩子 + 样式

**Files:**

- Modify: `src/utils/host/translate/dom/translation-insertion.ts`（`TranslationInsertionContext` 加 `renderTranslatedContent?`，解构并在 `translatedNode.textContent = translatedText` 处分支，照抄 `$UP`）
- Modify: `src/assets/styles/translation-node-preset.css`（把 `$UP` 版本对每条 `*` 规则的 `:not(:where(.read-frog-inline-atom, ...))` 排除与 `.read-frog-inline-atom { overflow-wrap: normal }` 照抄过来；注意 diff 是纯 PR hunks）
- Test: `src/utils/host/__tests__/translate.integration.test.tsx`（先只加依赖钩子的用例放 Task 6 一并跑；本任务验证不回归）

**Interfaces（产出）:** `insertTranslatedNodeIntoWrapper` 的 context 多出 `renderTranslatedContent?: (node, text) => void`。

- [ ] Step 1: 改 `translation-insertion.ts` 与 CSS
- [ ] Step 2: `SKIP_FREE_API=true pnpm vitest run src/utils/host/__tests__/translate.integration.test.tsx` → 全绿（无回归）
- [ ] Step 3: commit `feat(translate): 插入层支持自定义译文渲染，样式排除原子子树`

### Task 6: 双语主管线接入 + 集成测试

**Files:**

- Modify: `src/utils/host/translate/core/translation-modes.ts`（只移植 PR hunks：import inline-atoms；虚拟段落条件加 `!containsInlineAtomOutsideWrappers(...)`；`textContent` 改双串 `atomExtraction` 抽取 + 纯公式段 return；`getTranslatedTextAndRemoveSpinner`/`translateTextForPage`/`getDisplayTranslation`/`sourceText` 用 `requestText`；加 `renderTranslatedContent` 条件钩子。**不移植** `isSystemProviderRef` 与 `canSplitGiantWithoutStrandingOwnText` 相关上游改动）
- Test: `src/utils/host/__tests__/translate.integration.test.tsx`（移植 `$UP` 的 `bilingual inline atoms (formulas)` 整个 describe，8 个用例；注意 `$MT` 若无 `PRESERVE_LINE_BREAKS_TRANSLATION_OPTIONS` 常量则以 `$UP` 测试文件同名为准从其 import 处对齐）

- [ ] Step 1: 移植集成测试 describe
- [ ] Step 2: `SKIP_FREE_API=true pnpm vitest run src/utils/host/__tests__/translate.integration.test.tsx` → 新用例 FAIL
- [ ] Step 3: 改 `translation-modes.ts`（对照 `$UP` 458-477、518-545、631-705 行 hunks）
- [ ] Step 4: 复跑 → 全绿
- [ ] Step 5: commit `feat(translate): 双语模式占位符发送与公式回填接入主管线`

### Task 7: 后台缓存审计（手工适配 queues.ts）

**Files:**

- Modify: `src/entrypoints/background/translation-queues.ts`（**手工适配**，勿整段复制上游：在 webpage 纯文本队列缓存块 `$MT` 约 601-608 行处，`if (result && hash)` 前加 `inlineAtomTokensIntact` 判定（`!hasInlineAtomTokens(text) || isNoTranslationSentinel(result) || auditInlineAtomTokens(text, result).ok`），不 intact 则 `logger.warn` 且不落缓存。第 731-740 行的第二处缓存块：先确认其所属 handler 是否处理网页纯文本（若为字幕/摘要等非 atom 路径则不加）。import `auditInlineAtomTokens/hasInlineAtomTokens` 与 `isNoTranslationSentinel`）
- Test: `src/entrypoints/background/__tests__/translation-queues.test.ts`（移植 `$UP` 三个新用例：正常缓存、丢占位符不缓存、sentinel 豁免）

- [ ] Step 1: 移植三个测试用例（对齐 `$MT` 测试文件的 mock 设施命名）
- [ ] Step 2: 复跑 → FAIL
- [ ] Step 3: 手工改 `translation-queues.ts`
- [ ] Step 4: 复跑 → 全绿
- [ ] Step 5: commit `feat(translate): 占位符不完整的译文不写入缓存`

### Task 8: 内置规则种子 + changeset + 终验

**Files:**

- Modify: `src/utils/site-rules/built-in/rules.json`（插入 `$UP` 第 39-62 行的 `readfrog-atom-defaults` 规则整块；第 1596 行 sciencedirect 规则加 `"atomSelectors.add": ["span.math"]`；**保留** MeowTabby 的 `white-space:unset` video-title 行）
- Create: `.changeset/inline-formula-atoms.md`（照抄 `$UP`，包名改 `"@read-frog/extension"` 保持不变——MeowTabby 未改包名）

- [ ] Step 1: 改 rules.json（用 `node -e "JSON.parse(...)"` 验证 JSON 合法）
- [ ] Step 2: `SKIP_FREE_API=true pnpm vitest run src/utils/site-rules/__tests__/built-in.test.ts` → PASS
- [ ] Step 3: 加 changeset 文件
- [ ] Step 4: 终验：`SKIP_FREE_API=true pnpm test` 全绿 + `pnpm lint` 0 错误
- [ ] Step 5: commit `feat(translate): 内置规则预置常见公式渲染器原子选择器`

## Self-Review

- 覆盖检查：上游 15 个 PR 文件 → changeset(T8)、css(T5)、queues.test(T7)、queues.ts(T7)、site-rules.ts(T2)、dom-labels(T3)、integration.test(T6)、filter.test(T3)、traversal.test(T3)、filter.ts(T3)、traversal.ts(T3)、tokens.test(T1)、translation-modes(T6)、atoms.test(T4)、atoms.ts(T4)、insertion(T5)、tokens.ts(T1)、resolve.ts+resolve.test(T2)、rules.json(T8)。全覆盖。
- 分叉点已标记：queues.ts（手工适配）、translation-modes.ts（只取 PR hunks）、rules.json（保留自有行）、prompt.ts/effective.ts（无需改）。
