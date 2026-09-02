# 结构化对象接入 billing 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把词典（自定义动作）与笔记建议的内置 AI 通道从 read-frog 免费服务器（oRPC）切到 billing `/v1/generate`，获得 401/402 闸门与计费。

**Architecture:** 结构化流本质是文本流（前端 `parsePartialJson` 自行解析），billing 文本流 parts 形状完全兼容现有消费者。新增一个 `createBillingStructuredObjectPartStream`：把 zod schema 经 `z.toJSONSchema()` 变成「只输出 JSON」指令拼进 systemPrompt，然后复用 `createBillingTextPartStream`；两处 hosted 分支改接线，删除两个 oRPC hosted 函数。

**Tech Stack:** TypeScript / zod ^4.4.3（`z.toJSONSchema` 原生）/ vitest / WXT background service worker

**Spec:** `specs/superpowers/2026-09-01-structured-object-billing-design.md`（决策 D1-D5、风险与验收口径以 spec 为准）

## Global Constraints

- 分支：`chore-设置-自定义页默认空白-词典逻辑待理清`（基线 `db36491`）；全程不切分支
- 测试命令一律带环境变量前缀：`SKIP_FREE_API=true pnpm vitest run <files>`
- commit 走 conventional commit（husky commitlint 强制）；**只 `git add` 目标文件**（工作区可能有其他未提交改动，严禁 `git add -A` / `git commit --amend`）
- billing 错误**不经过** `normalizeHostedAiError`（spec D3）：`BillingApiError` 自带 meta（`statusCode`/`kind`/`isRetryable`）直接冒泡
- 后端零改动：`feature` 是 ≤64 字符自由落账标签
- `modelTier`/`temperature` 丢弃（billing 单模型）；`maxOutputTokens` 透传
- 本地/BYOK 路径（AI SDK `Output.object`）一行不动

---

### Task 1: `buildJsonOutputDirective` + `BillingFeature` 扩展

**Files:**

- Modify: `src/utils/billing/types.ts`（`BillingFeature` 联合类型，L4-13）
- Modify: `src/utils/ai/structured-object-schema.ts`（追加新函数）
- Create: `src/utils/ai/__tests__/structured-object-schema.test.ts`

**Interfaces:**

- Produces: `buildJsonOutputDirective(schema: z.ZodType): string` —— Task 2 的 billing 通道函数调用它生成指令文本
- Produces: `BillingFeature` 新成员 `"customAction" | "noteSuggestion"` —— Task 2 接线时作 feature 标签

- [ ] **Step 1: 写失败测试**

创建 `src/utils/ai/__tests__/structured-object-schema.test.ts`：

```ts
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { buildJsonOutputDirective, createStructuredObjectSchema } from "../structured-object-schema"

describe("buildJsonOutputDirective", () => {
  it("embeds the JSON Schema of a flat custom-action schema", () => {
    const schema = createStructuredObjectSchema([
      { name: "term", type: "string" },
      { name: "score", type: "number" },
    ])
    const directive = buildJsonOutputDirective(schema)

    expect(directive).toContain('"term"')
    expect(directive).toContain('"score"')
    expect(directive).toContain('"type":"string"')
    expect(directive).toContain('"type":"number"')
  })

  it("forbids extra properties and non-JSON output", () => {
    const schema = createStructuredObjectSchema([{ name: "term", type: "string" }])
    const directive = buildJsonOutputDirective(schema)

    // strictObject → additionalProperties: false in the embedded schema
    expect(directive).toContain('"additionalProperties":false')
    expect(directive).toContain("JSON")
  })

  it("supports nested schemas (note suggestion envelope shape)", () => {
    const schema = z.object({
      action: z.object({ summaryFieldName: z.string().nullable() }),
      notes: z.array(
        z.object({ fields: z.array(z.object({ name: z.string(), value: z.string() })) }),
      ),
    })
    const directive = buildJsonOutputDirective(schema)

    expect(directive).toContain('"notes"')
    expect(directive).toContain('"array"')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `SKIP_FREE_API=true pnpm vitest run src/utils/ai/__tests__/structured-object-schema.test.ts`
Expected: FAIL —— `buildJsonOutputDirective` 未导出（编译/导入错误）

- [ ] **Step 3: 最小实现**

`src/utils/ai/structured-object-schema.ts` 末尾追加：

```ts
/**
 * Build the "output JSON only" directive appended to the system prompt for
 * billing structured-object runs. Billing /v1/generate is a plain-text
 * protocol — unlike the AI SDK's Output.object (local path), nothing else
 * tells the model to emit JSON, so the schema travels as text.
 */
export function buildJsonOutputDirective(schema: z.ZodType): string {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema))
  return [
    "## Output format (mandatory)",
    "Respond with a single JSON object and nothing else — no prose, no markdown fences.",
    "It must validate against this JSON Schema:",
    jsonSchema,
  ].join("\n")
}
```

`src/utils/billing/types.ts` 的 `BillingFeature` 联合追加两个成员（保持字母序放在 `"summarization"` 后、`"pdfTranslation"` 后均可，与现有风格一致）：

```ts
  | "customAction"
  | "noteSuggestion"
```

- [ ] **Step 4: 跑测试确认通过**

Run: `SKIP_FREE_API=true pnpm vitest run src/utils/ai/__tests__/structured-object-schema.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add src/utils/ai/structured-object-schema.ts src/utils/ai/__tests__/structured-object-schema.test.ts src/utils/billing/types.ts
git commit -m "feat(billing): add JSON output directive builder and customAction/noteSuggestion feature tags"
```

---

### Task 2: billing 结构化通道接线 + 退役 oRPC 免费通道

**Files:**

- Modify: `src/entrypoints/background/background-stream.ts`
- Modify: `src/entrypoints/background/__tests__/background-stream.test.ts`

**Interfaces:**

- Consumes: `buildJsonOutputDirective(schema)`（Task 1）、`createBillingTextPartStream(input, signal?)`（现有，`src/utils/billing/generate.ts`，入参 `{ systemPrompt, prompt, requestId, feature, maxOutputTokens? }`）
- Produces: 模块私有 `createBillingStructuredObjectPartStream(payload, options, signal?)`，`options = { feature: BillingFeature, objectSchema: z.ZodType, inputSchema: z.ZodType }`；`runStructuredObjectStreamInBackground` 与 `runNoteSuggestionStreamInBackground` 的 hosted 分支改调它
- 删除: `createHostedStructuredObjectPartStream`（L833-863）、`createHostedNoteSuggestionPartStream`（L887-913）、`normalizeHostedPartStreamErrors`（L427 起，仅这两处调用）、`HostedStreamFn` 类型（L55-58，仅这两处使用）、`backgroundOrpcClient` import（L41，仅这两处使用）

**背景事实（执行者必读）：**

- 现有测试已 mock `@/utils/billing/generate`（`createBillingTextPartStreamMock`，测试文件 L63-65）——直接用
- 现有测试 mock 了 `@/utils/orpc/background-client`（L50-61）——退役后整个 `vi.mock` 块与两个 mock 变量删除
- hosted noteSuggestion 的契约对象形状（信封适配的输入，测试 fixture 照抄）：

```ts
{
  action: { createNewDictionaryAction: false, targetActionId: null, summaryFieldName: "definition" },
  notes: [{ fields: [{ name: "Word", value: "ephemeral" }] }],
}
```

- billing 错误 meta 形状（`classifyBillingHttpError` 附加）：401/402 → `{ statusCode, kind: "access-denied", isRetryable: false }`；429 → `{ statusCode, kind: "rate-limit", isRetryable: true }`。retry policy 裁决：`access-denied` → `{ action: "fail", failQueue: true }`；`rate-limit` → `{ action: "pause-and-retry", pauseMs }`

- [ ] **Step 1: 改造测试（先红）**

对 `src/entrypoints/background/__tests__/background-stream.test.ts` 做以下修改：

1. **删除** L50-61 的 `vi.mock("@/utils/orpc/background-client", ...)` 整块，以及 `hostedStreamStructuredObjectMock`、`hostedNoteSuggestionStreamMock` 两个变量声明（L13-14）。

2. **改写 hosted 结构化对象成功用例**（现 L236 起，providerId `read-frog-advance-ai`）——mock 源换成 billing，断言指令注入：

```ts
it("streams hosted structured objects through the billing text stream", async () => {
  createBillingTextPartStreamMock.mockResolvedValue(
    (async function* () {
      yield { type: "text-delta", text: '{"score":' }
      yield { type: "text-delta", text: "5}" }
      yield { type: "finish", finishReason: "stop" }
    })(),
  )

  const chunkSnapshots: BackgroundStructuredObjectStreamSnapshot[] = []
  const { runStructuredObjectStreamInBackground } = await import("../background-stream")
  const result = await runStructuredObjectStreamInBackground(
    {
      providerId: "read-frog-advance-ai",
      modelTier: "advance",
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      instructions: "Return structured data",
      prompt: "Analyze selection",
      outputSchema: [{ name: "score", type: "number" }],
    },
    {
      onChunk: (snapshot) => {
        chunkSnapshots.push(snapshot)
      },
    },
  )

  expect(createBillingTextPartStreamMock).toHaveBeenCalledTimes(1)
  const call = createBillingTextPartStreamMock.mock.calls[0][0]
  expect(call).toMatchObject({
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    feature: "customAction",
    prompt: "Analyze selection",
  })
  // Directive injection: original instructions + JSON contract as text.
  expect(call.systemPrompt).toContain("Return structured data")
  expect(call.systemPrompt).toContain('"score"')
  expect(call.systemPrompt).toContain("JSON")
  expect(result.output).toEqual({ score: 5 })
})
```

（保留原用例中 chunk 快照断言的语义：`chunkSnapshots` 逐帧累积 partial object。）

3. **替换三个 oRPC 错误归一用例**（`"normalizes guest rate limiting…"` L296 起、`"does not normalize billing-period quota exhaustion…"` L326 起、`it.each TIER_RESTRICTED/UNAUTHORIZED` L369 起）为 billing 错误场景：

```ts
it("drains the backlog on a billing 402 from a structured object run", async () => {
  createBillingTextPartStreamMock.mockRejectedValue(
    Object.assign(new Error("需使用自定义API，或登录充值使用"), {
      statusCode: 402,
      kind: "access-denied",
      isRetryable: false,
    }),
  )

  const { runStructuredObjectStreamInBackground } = await import("../background-stream")

  let caught: unknown
  try {
    await runStructuredObjectStreamInBackground({
      providerId: "read-frog-free-ai",
      modelTier: "normal",
      requestId: "123e4567-e89b-42d3-a456-426614174001",
      instructions: "Return structured data",
      prompt: "Analyze selection",
      outputSchema: [{ name: "score", type: "number" }],
    })
  } catch (error) {
    caught = error
  }

  // The fixed guidance copy survives untouched — no oRPC re-normalization.
  expect((caught as Error).message).toBe("需使用自定义API，或登录充值使用")
  expect(
    defaultRequestRetryPolicy.decide(caught, {
      retryCount: 0,
      maxRetries: 2,
      baseRetryDelayMs: 1_000,
      now: Date.now(),
      rateLimitRetryCount: 0,
      consecutiveRateLimits: 0,
    }),
  ).toEqual({ action: "fail", failQueue: true })
})

it("keeps a billing 429 retryable on the rate-limit path", async () => {
  createBillingTextPartStreamMock.mockRejectedValue(
    Object.assign(new Error("请求过于频繁"), {
      statusCode: 429,
      kind: "rate-limit",
      isRetryable: true,
      // Deterministic pause: Retry-After wins over the jittered backoff
      // (same technique as the retired oRPC guest-rate-limit case).
      retryAfterMs: 42_000,
    }),
  )

  const { runStructuredObjectStreamInBackground } = await import("../background-stream")

  let caught: unknown
  try {
    await runStructuredObjectStreamInBackground({
      providerId: "read-frog-free-ai",
      modelTier: "normal",
      requestId: "123e4567-e89b-42d3-a456-426614174002",
      instructions: "Return structured data",
      prompt: "Analyze selection",
      outputSchema: [{ name: "score", type: "number" }],
    })
  } catch (error) {
    caught = error
  }

  expect(
    defaultRequestRetryPolicy.decide(caught, {
      retryCount: 0,
      maxRetries: 2,
      baseRetryDelayMs: 1_000,
      now: Date.now(),
      rateLimitRetryCount: 0,
      consecutiveRateLimits: 0,
    }),
  ).toEqual({ action: "pause-and-retry", pauseMs: 42_000 })
})
```

（429 的 `pauseMs` 具体值以 `defaultRequestRetryPolicy` 实现为准——若现有文本流 429 用例有断言值，照抄该值。）

4. **改写 hosted noteSuggestion 成功用例**（现 L1113-1177，`read-frog-advance-ai`）——mock 源换 billing，契约 fixture 不变：

```ts
createBillingTextPartStreamMock.mockResolvedValue(
  (async function* () {
    yield { type: "text-delta", text: hostedObjectJson.slice(0, 40) }
    yield { type: "text-delta", text: hostedObjectJson.slice(40) }
    yield { type: "finish", finishReason: "stop" }
  })(),
)
```

断言改为：

```ts
expect(createBillingTextPartStreamMock).toHaveBeenCalledTimes(1)
const call = createBillingTextPartStreamMock.mock.calls[0][0]
expect(call).toMatchObject({
  feature: "noteSuggestion",
  requestId: "123e4567-e89b-42d3-a456-426614174010",
  prompt: "Selection context",
})
expect(call.systemPrompt).toContain("Suggest words")
expect(call.systemPrompt).toContain('"summaryFieldName"')
```

信封适配断言（`result.output` 无 `action` 属性、`summaryFieldName` 存活）**原样保留**。

5. **改写** `"defaults hosted note suggestion modelTier to normal when absent"`（L1179-1206）：billing 路径 modelTier 被丢弃，断言改为 `expect(createBillingTextPartStreamMock).toHaveBeenCalledTimes(1)`（safeParse 的 modelTier default 仍保证契约校验通过）。

6. **保留不动**：`"rejects invalid hosted note suggestion input…"`（L1208 起，safeParse 仍在 billing 函数内）、所有 local 路径用例（`openai-default`）、文本流用例。

- [ ] **Step 2: 跑测试确认失败**

Run: `SKIP_FREE_API=true pnpm vitest run src/entrypoints/background/__tests__/background-stream.test.ts`
Expected: FAIL —— 新断言期望 billing 被调用，实际仍走 oRPC（且 oRPC mock 已删，hosted 用例直接报错）

- [ ] **Step 3: 实现**

`src/entrypoints/background/background-stream.ts`：

1. **新增** billing 结构化通道函数（放在 `createHostedTextPartStream` 之后）：

```ts
async function createBillingStructuredObjectPartStream(
  serializablePayload:
    | BackgroundStreamStructuredObjectSerializablePayload
    | BackgroundStreamNoteSuggestionSerializablePayload,
  options: { feature: BillingFeature; objectSchema: z.ZodType; inputSchema: z.ZodType },
  signal?: AbortSignal,
): Promise<AsyncIterable<unknown>> {
  const { instructions, prompt, temperature, modelTier, requestId, maxOutputTokens } =
    serializablePayload
  const { feature, objectSchema, inputSchema } = options

  // Same contract pre-validation as the retired oRPC path: converges the
  // hosted-only constraints (field-name length, field count) locally instead
  // of as a doomed paid request. Zod strips keys the note-suggestion schema
  // does not declare (outputSchema), so one candidate object serves both.
  const input = inputSchema.safeParse({
    instructions,
    prompt,
    temperature,
    modelTier,
    requestId,
    ...("outputSchema" in serializablePayload
      ? { outputSchema: serializablePayload.outputSchema }
      : {}),
  })
  if (!input.success) {
    throw new BackgroundStreamError("invalid_request", "Invalid hosted AI request")
  }
  if (!input.data.requestId) {
    throw new BackgroundStreamError("invalid_request", "Hosted AI request requires requestId")
  }

  // Billing /v1/generate is a plain-text protocol: the JSON contract travels
  // as a directive appended to the system prompt (the AI SDK's Output.object
  // does the equivalent injection for the local path). Billing errors bubble
  // as-is — their retry meta is already attached by classifyBillingHttpError.
  const directive = buildJsonOutputDirective(objectSchema)
  const systemPrompt = [input.data.instructions, directive].filter(Boolean).join("\n\n")

  return createBillingTextPartStream(
    {
      systemPrompt,
      prompt: input.data.prompt,
      requestId: input.data.requestId,
      feature,
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    },
    signal,
  )
}
```

2. **改接线** `runStructuredObjectStreamInBackground`（现 L876-878）：

```ts
const partStream = isBuiltInAiProviderId(serializablePayload.providerId)
  ? await createBillingStructuredObjectPartStream(
      serializablePayload,
      {
        feature: "customAction",
        objectSchema,
        inputSchema: HostedAiStreamStructuredObjectInputSchema,
      },
      signal,
    )
  : await createLocalStructuredObjectPartStream(serializablePayload, objectSchema, options)
```

3. **改接线** `runNoteSuggestionStreamInBackground` hosted 分支（现 L940-944）：

```ts
const partStream = await createBillingStructuredObjectPartStream(
  serializablePayload,
  {
    feature: "noteSuggestion",
    objectSchema: HostedAiNoteSuggestionObjectSchema,
    inputSchema: HostedAiNoteSuggestionStreamInputSchema,
  },
  signal,
)
const hostedSnapshot = await consumeStructuredObjectPartStream(partStream, {
  objectSchema: HostedAiNoteSuggestionObjectSchema,
  signal,
})
```

（其后 L945-954 的信封适配**原样保留**。）

4. **删除**：`createHostedStructuredObjectPartStream`（L833-863）、`createHostedNoteSuggestionPartStream`（L887-913）、`normalizeHostedPartStreamErrors`（L427 起）、`HostedStreamFn` 类型（L55-58）、`backgroundOrpcClient` import（L41）。
5. **import 调整**：新增 `import { buildJsonOutputDirective } from "@/utils/ai/structured-object-schema"`；`HostedAiStreamStructuredObjectInputSchema`/`HostedAiNoteSuggestionStreamInputSchema` 保留（safeParse 仍用）。删除后跑 lint，按 oxlint 报告清理其他闲置 import（如 `HostedAiRateLimitErrorDataSchema` 若仅被已删函数使用）。

- [ ] **Step 4: 跑测试确认通过**

Run: `SKIP_FREE_API=true pnpm vitest run src/entrypoints/background/__tests__/background-stream.test.ts`
Expected: PASS（全部用例，含保留的 local/文本流/invalid-input 用例）

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/background/background-stream.ts src/entrypoints/background/__tests__/background-stream.test.ts
git commit -m "feat(billing): route structured objects and note suggestions through /v1/generate"
```

---

### Task 3: 全量回归 + lint + 端到端清单

**Files:** 无新改动（回归验证；如有回归修复则一并 commit）

- [ ] **Step 1: billing + background 全量单测**

Run: `SKIP_FREE_API=true pnpm vitest run src/utils/billing src/entrypoints/background src/utils/ai`
Expected: 全部 PASS

- [ ] **Step 2: 全量 lint（含 type-check）**

Run: `pnpm lint`
Expected: 0 error（重点确认无 unused import 残留）

- [ ] **Step 3: 全量测试兜底**

Run: `SKIP_FREE_API=true pnpm test`
Expected: 全部 PASS

- [ ] **Step 4: 手工端到端（构建后用户执行）**

`WXT_SKIP_ENV_VALIDATION=true pnpm build` → 加载 `.output/chrome-mv3`：

1. 未登录 → 划词点词典 → 内联错误「请先登录」（不再出结果）
2. 登录但余额 0 → 点词典 → 「需使用自定义API，或登录充值使用」
3. 充值后 → 词典正常出词条；`/me` 的 recent_calls 出现 `feature=customAction` 落账
4. 笔记建议：翻译后建议卡正常（`feature=noteSuggestion` 落账）

- [ ] **Step 5: 如有修正，commit**

```bash
git add <修正的文件>
git commit -m "fix(billing): <说明>"
```
