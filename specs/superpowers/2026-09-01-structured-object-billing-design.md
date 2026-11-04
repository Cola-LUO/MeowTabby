# 设计：结构化对象通道接入 billing（词典/自定义动作 + 笔记建议）

日期：2026-09-01
分支基线：`chore-设置-自定义页默认空白-词典逻辑待理清` @ `db36491`
状态：待用户批准

## 1. 背景与目标

词典（自定义动作）与笔记建议（noteSuggestion）的内置 AI 通道目前直连 read-frog
原版免费服务器（`api.readfrog.app`，oRPC），**不经过 billing 后端**：无登录/余额
闸门（未登录、余额 ≤ 0 照样出结果）、不计费。这与「内置 AI = billing 付费通道」
的产品语义相悖，也使 402 文案「需使用自定义API，或登录充值使用」（`db36491`）
对这两条链路不生效。

目标：把这两条结构化对象链路的内置 AI 分支切到 billing `/v1/generate`，获得：

1. 401/402 闸门（未登录 → 「请先登录」；余额 ≤ 0 → 「需使用自定义API，或登录充值使用」）
2. 按 feature 标签计费落账
3. requestId 幂等（复用现有机制）

## 2. 现状（三条关键事实）

### 2.1 结构化流的本质是文本流

`consumeStructuredObjectPartStream`（background-stream.ts L560-632）消费的 parts
就是 AI SDK 文本流形状（`text-delta` / `reasoning-*` / `finish` / `error`）：
`text-delta` → 累积文本 → `parsePartialJson` 增量解析 → 最终 `objectSchema.parse`
校验。**前端自己做结构化解析**，不依赖服务端解析。

因此 billing 文本流（`createBillingTextPartStream` 产出 `text-delta`/`finish`/
`error` parts）与该消费者**形状完全兼容**——本地路径（AI SDK `streamText` +
`Output.object`）的流也是同形状。新通道无需新消费者。

### 2.2 缺的只是「schema → 输出指令」注入

read-frog 服务端对两个 oRPC 端点用 `Output.object({ schema })`（AI SDK 会把 zod
schema 转 JSON Schema 注入模型请求），所以客户端发的 instructions/prompt 是
「裸」的。billing 是纯文本协议，**前端必须自己把 schema 变成输出指令文本**拼进
prompt。这是本设计唯一的新逻辑。

### 2.3 两条链路的 schema 形状不同

- 词典/自定义动作：`createStructuredObjectSchema(outputSchema)` —— 扁平
  strictObject，字段 string|number nullable（`src/utils/ai/structured-object-schema.ts`）
- 笔记建议：`HostedAiNoteSuggestionObjectSchema`（api-contract 固定契约，
  `action.summaryFieldName` + `notes[]`）——注意 hosted 版与本地版信封
  （`noteSuggestionEnvelopeSchema`，无 action 包裹）形状不同，billing 路径
  必须按 hosted 契约注入指令，现有信封适配层（L945-954）才能照常工作

## 3. 方案总览

```
词典/自定义动作（内置 AI）
  runStructuredObjectStreamInBackground
    └─ [改] hosted 分支 → createBillingStructuredObjectPartStream
         ├─ 指令注入：z.toJSONSchema(objectSchema) → 「只输出 JSON」指令 ⊕ systemPrompt
         └─ createBillingTextPartStream（session Bearer / 401 / 402 / 幂等 / 计费）
  consumeStructuredObjectPartStream（原样复用：parsePartialJson + 最终校验）

笔记建议（内置 AI）
  runNoteSuggestionStreamInBackground
    └─ [改] hosted 分支 → createBillingStructuredObjectPartStream
         └─ 同上，schema = HostedAiNoteSuggestionObjectSchema
  信封适配（原样复用：action.summaryFieldName → summaryFieldName）
```

后端零改动：`/v1/generate` 的 `feature` 是 ≤64 字符自由落账标签（PDF 吸收时已验证）。

## 4. 关键设计决策

### D1 指令注入：zod v4 `z.toJSONSchema()` + 固定指令模板

- 项目 zod ^4.4.3，`z.toJSONSchema()` 原生可用，无需新依赖
- 新函数 `buildJsonOutputDirective(schema: z.ZodType): string`（放
  `src/utils/ai/structured-object-schema.ts` 旁）：
  `JSON.stringify(z.toJSONSchema(schema))` 包进固定模板——「只输出一个符合以下
  JSON Schema 的 JSON 对象，禁止输出任何其他文本或代码围栏」
- 拼接位置：`systemPrompt = [instructions, directive].filter(Boolean).join("\n\n")`
- 选它而非手写字段模板的理由：一份代码覆盖扁平（词典）与嵌套（笔记建议 notes[]
  数组）两种形状；与 AI SDK `Output.object` 注入 JSON Schema 的行为同构

### D2 feature 标签：新增 `customAction` 与 `noteSuggestion`

- `src/utils/billing/types.ts` 的 `BillingFeature` 联合加 `"customAction" | "noteSuggestion"`
- 后端零改动（标签只存储不解析）；账单可按这两维拆分
- `modelTier`/`temperature` 丢弃（billing 单模型，与文本流 hosted 路径同口径）；
  `maxOutputTokens` 透传

### D3 错误透传：billing 错误不过 oRPC 归一器

- `normalizeHostedAiError` 只认 read-frog oRPC 错误码；billing 路径**不经过它**，
  `BillingApiError` 自带的 meta（`classifyBillingHttpError` 已附
  statusCode/kind/isRetryable）直接冒泡
- 错误出口（L253 `extractAISDKErrorMessage`）取 `.message` → 402 即
  「需使用自定义API，或登录充值使用」，401 即「请先登录/会话已过期」——
  与文本流链路文案自动一致，零额外文案工作

### D4 退役 oRPC 免费通道

- 删除 `createHostedStructuredObjectPartStream`（L833-863）与
  `createHostedNoteSuggestionPartStream`（L887-913）
- `backgroundOrpcClient.hostedAi.*` 在 background-stream 内的引用清零；
  oRPC client 本身不动（其他模块可能仍用）
- 效果：词典/笔记建议不再有绕过 billing 的免费通道（堵住「未登录也能出结果」）

### D5 requestId 幂等照旧

- 词典：`use-custom-action-execution` 每次运行 `getRandomUUID()`，重试由
  RequestQueue 复用同一 key（PDF 吸收已确立的约定）
- 笔记建议：payload 已带 requestId；未登录静默跳过逻辑（`useNoteSuggestion`
  的 hosted status 预检）不动

## 5. 改动清单

| 文件                                                   | 改动                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/utils/billing/types.ts`                           | `BillingFeature` 加 `"customAction" \| "noteSuggestion"`                                           |
| `src/utils/ai/structured-object-schema.ts`             | 新增 `buildJsonOutputDirective(schema)`                                                            |
| `src/entrypoints/background/background-stream.ts`      | 新增 `createBillingStructuredObjectPartStream`；两处 hosted 分支改接线；删两个 oRPC hosted 函数    |
| `src/entrypoints/background/background-stream.ts` 测试 | 结构化/noteSuggestion 用例改断言 billing 通道；新增 402 文案透传、指令注入内容、非法 JSON 容错用例 |

预计 ~150 行（含测试）。

## 6. 风险与验证点

1. **模型输出带 ```json 围栏**：`parsePartialJson`（ai 包）对围栏的容忍度待实测；
   若最终解析失败率不可接受，在累积侧剥围栏（进 `parsePartialJson` 前正则剥离）。
   验证方式：真实词典查询 10 次（中/英/日各若干）。
2. **strictObject 与模型多吐字段**：`z.strictObject` 会拒多吐字段 →
   `output_validation_failed`。read-frog 服务端同风险，非新增；若实测频发，
   降级为 `z.object`（忽略多余字段）——留作实测后决策，不预先做。
3. **笔记建议 schema 契约**：注入指令按 `HostedAiNoteSuggestionObjectSchema` 生成，
   信封适配层不改；`action.createNewDictionaryAction` 等富字段仍被丢弃（现状语义）。
4. **计费语义变化**：词典/笔记建议从「免费（read-frog 承担）」变「用户余额扣费」，
   与「内置 AI = 付费托管」产品语义一致，属预期变化。

## 7. 测试计划

- 单测：指令注入内容（含 JSON Schema 片段）、402/401 错误透传 message、
  parts 流兼容（text-delta 累积 → parsePartialJson → 最终 parse）、
  noteSuggestion 信封适配不变
- 手工端到端：未登录点词典 → 「请先登录」；登录但余额 0 → 「需使用自定义API，
  或登录充值使用」；充值后 → 正常出词条且 `/me` 落账 `customAction` 标签
- 回归：`SKIP_FREE_API=true pnpm vitest run`（billing + background-stream 相关）

## 8. 明确不做

- 后端不加结构化端点（前端解析已够，协议保持纯文本）
- 不动本地/BYOK 路径（AI SDK `Output.object` 照旧）
- 不动 `useNoteSuggestion` 的未登录静默跳过预检（后台自动触发的既有体验）
- 不做输出围栏的预先剥离（实测后再定，见风险 1）
