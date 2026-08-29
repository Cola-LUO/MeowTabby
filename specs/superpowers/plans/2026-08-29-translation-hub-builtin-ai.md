# 翻译中心接入内置 AI（普通/高级）实施计划

日期：2026-08-29 · 状态：设计已经用户批准（产品决策：**默认勾选**）

## 背景与目标

翻译中心（`src/entrypoints/translation-hub/`，页面标题「多接口文本翻译」）目前的服务商下拉只列本地配置的翻译服务商，选不到内置 AI（普通/高级）。本计划把两个系统级内置 AI 服务商加进该下拉并打通执行路径，走 billing 托管通道（与划词翻译同一条 `translateTextCore` → `enqueueTranslateRequest` 管线）。

**不新增页面、不改后端、不改 `@read-frog/api-contract`。**

## Global Constraints（约束，所有任务隐含遵守）

1. **只改 `MeowTabby/`**。`github克隆到本地/read-frog/`（原作）与 `billing-backend/` 一律不动。
2. **`hostedFeature` 一律传 `"selectionTranslation"`**（`HostedAiFeatureSchema` 是契约包固定枚举，不加新值；"用户主动发起的文本翻译"按划词翻译档计费/闸门）。
3. **默认勾选**：`selectedProviderIdsAtom` 的默认值 = 启用的本地翻译服务商 id + `BUILT_IN_AI_PROVIDER_ID` + `BUILT_IN_AI_ADVANCE_PROVIDER_ID`（去重；本地仍只含 enabled 的 translate providers）。
4. **可用性**：下拉中内置 AI 两项在未登录/托管不可用时置灰并引导登录（复用 `useHostedAiStatus`）；置灰仅影响交互，不改变默认选中状态本身。
5. **名称/logo 复用现有资产**：名称走 `getBuiltInAiProviderName(id)`（i18n 键 `options.apiProviders.providers.name.builtInAi` / `builtInAiAdvance`，9 语言已存在）；logo 用 `BUILT_IN_AI_PROVIDER_LOGO`。如需新增 UI 文案（如分组标题、登录引导），以 `en.yml` 为基准补全 9 语言（zh-CN 给中文，其余 7 语言可先复制英文原文）。
6. **测试**：`SKIP_FREE_API=true pnpm test` 全绿、`pnpm lint` 干净。UI 文案如新增需通过类型门。
7. UI 风格遵循文件内既有写法（jotai atom、shadcn 组件、现有 dropdown 分组结构）。

## 现状要点（实现者需要的事实）

- 系统服务商定义：`src/utils/providers/provider-registry.ts` — `SYSTEM_PROVIDER_DEFS`（id：`BUILT_IN_AI_PROVIDER_ID`/`BUILT_IN_AI_ADVANCE_PROVIDER_ID`，modelTier normal/advance）；能力类型 `ProviderCapability = FeatureKey | "customAction" | "languageDetection"`；本地谓词表 `LOCAL_PROVIDER_CAPABILITY_PREDICATES`。
- hub 数据源：`src/entrypoints/translation-hub/atoms.ts` — `selectedProviderIdsAtom` 默认取 `filterEnabledProvidersConfig(getTranslateProvidersConfig(providersConfig)).map(p => p.id)`。
- hub 下拉：`src/entrypoints/translation-hub/components/translation-service-dropdown.tsx` — 现按 LLM / nonAPI / pureAPI 三组渲染本地服务商。
- hub 卡片：`src/entrypoints/translation-hub/components/translation-card.tsx` — `getProviderConfigById` 查本地配置（系统 id 会查不到），翻译走 `executeTranslate`；`prompt-selector.tsx` 的 `hasLLMProvider` 只认本地 LLM。
- 系统路径：`src/utils/host/translate/translate-variants.ts`（`translateTextForInput` 是同类薄封装范本）→ `translate-text.ts` `translateTextCore(options)`（`providerConfig` 接受 `UnwrappedProviderRef`，必填 `hostedFeature`；prompt 由内部 `getTranslatePrompt` 组装，与 hub 卡片现用同一解析器，行为一致）。
- 可用性状态：`src/components/llm-providers/use-hosted-ai-status.ts`（返回 `HostedAiStatus`，6 个既有消费者）。
- 既有测试位置：`src/utils/providers/__tests__/`、`src/utils/host/translate/__tests__/`、`src/entrypoints/translation-hub/components/__tests__/`。

## Task 1: 能力注册 + hub 变体（库层）

**改 `src/utils/providers/provider-registry.ts`：**
- `ProviderCapability` 联合类型加 `"translationHub"`。
- `SYSTEM_PROVIDER_DEFS` 两个 def 的 `capabilities` 各加 `"translationHub"`。
- `LOCAL_PROVIDER_CAPABILITY_PREDICATES` 加 `translationHub: isTranslateProviderConfig`（record 完整性由 `satisfies` 强制）。

**改 `src/utils/host/translate/translate-variants.ts`：**
- 新增 `translateTextForHub(text: string, sourceCode: LangCodeISO6393 | "auto", targetCode: LangCodeISO6393, providerRef: UnwrappedProviderRef)`：类比 `translateTextForInput` 的薄封装（语言解析/目标语言跳过逻辑照抄其适用部分），内部调 `translateTextCore`，固定 `hostedFeature: "selectionTranslation"`；不带网页上下文（hub 是扩展页面，无网页上下文）、`textFormat: "plain"`。
- 不改动任何现有 variant 的行为。

**测试（新文件放对应 `__tests__/`）：**
- registry：`getSystemProviderIdsForCapability("translationHub")` 返回两个内置 AI id；`getSelectableProvidersForCapability`/`resolveProviderRefForCapability("translationHub", …)` 对系统 id 返回正确 `modelTier`；既有能力的行为不回归。
- variants：`translateTextForHub` 以系统 ref 调用 `translateTextCore` 且 `hostedFeature === "selectionTranslation"`（mock `sendMessage("enqueueTranslateRequest")`，参考既有 variants/translate-text 测试的 mock 方式）；目标语言跳过等继承逻辑按 `translateTextForInput` 的既有测试样式覆盖。

## Task 2: 翻译中心 UI 接线（atoms / 下拉 / 卡片 / 提示词选择器）

**改 `src/entrypoints/translation-hub/atoms.ts`：**
- `selectedProviderIdsAtom` 默认值按约束 3（本地 enabled + 两个系统 id，去重）。override 机制不动。

**改 `src/entrypoints/translation-hub/components/translation-service-dropdown.tsx`：**
- 新增「内置 AI」分组（两项：普通/高级），名称/logo 按约束 5。
- 可用性按约束 4（`useHostedAiStatus`），不可用时项置灰 + 引导登录文案。
- 勾选读写走现有 `selectedProviderIdsAtom` 逻辑。

**改 `src/entrypoints/translation-hub/components/translation-card.tsx：**
- `isBuiltInAiProviderId(providerId)` 时：名称 `getBuiltInAiProviderName`、logo `BUILT_IN_AI_PROVIDER_LOGO`、翻译改调 `translateTextForHub(req.inputText, req.sourceLanguage, req.targetCode, systemRef)`（`language.level` 若 variant 需要则透传）；系统 ref 用 `resolveProviderRefForCapability("translationHub", providersConfig, providerId)` 解析。非系统 id 走原 `executeTranslate` 路径，零行为变化。
- 失败展示沿用现有 mutation 错误路径（`HostedAiProviderUnavailableError` 等已有 i18n 文案）。

**改 `src/entrypoints/translation-hub/components/prompt-selector.tsx`：**
- `hasLLMProvider` 判定加：选中 id 含任一 `isBuiltInAiProviderId` 也视为有 LLM（内置 AI 是托管 LLM，提示词选择器应显示）。

**测试：**
- atoms：默认选中含两个系统 id 且与本地 enabled 合并去重；override 仍生效。
- dropdown：内置 AI 分组渲染（名称/两项）、未登录 mock 下置灰 + 引导文案；本地分组不回归。
- card：系统 id 分流到 `translateTextForHub`（mock variant）；本地 id 仍走 `executeTranslate`；系统 id 查本地配置为 undefined 不再抛 "Provider not found"。
- prompt-selector：仅内置 AI 选中时也显示。

## 收尾验证

- `SKIP_FREE_API=true pnpm test` 全绿；`pnpm lint` 干净。
- 手工冒烟（可选，用户侧）：dev 加载扩展 → 翻译中心下拉见「内置 AI」分组 → 登录后翻译出结果、`/me` 见扣费；未登录置灰。
