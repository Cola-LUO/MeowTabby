# MeowTabby × billing-backend 前端切片实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MeowTabby 的托管 AI 功能（网页翻译、选词/输入框翻译、字幕翻译与切分、摘要、语言检测）从 readfrog oRPC 切换到 billing-backend 的 `POST /v1/generate`（SSE），并在扩展内实现完整账户流（注册验证码/登录/找回密码/会话/余额），前端流式体验与渲染侧零改动。

**Architecture:** 只替换 background 托管文本流的**唯一漏斗** `createHostedTextPartStream`——新适配器对 billing-backend 发 SSE 请求，把 `delta/done/error` 事件翻译成现有 AI-SDK 风格 parts（`text-delta`/`finish`），下游 `consumeTextPartStream` → chrome port `chunk/done` 消息 → 页面渲染全部不动。账户体系新增 `src/utils/billing/` 模块（session 存 `chrome.storage.local`），选项页新增 Account 页面，账户菜单换芯。错误分级复用现有 `RequestQueue` retry-policy（401/402 → 抽干队列，429 → 暂停重试）。

**Tech Stack:** WXT (MV3) + React 19 + TypeScript (strict) + @tanstack/react-query + vitest (WxtVitest fake-browser) + i18next facade（`i18n.t`，9 语言 yml）

**Spec:** `/Users/Luo_F/vs_code/MeowTabby/specs/superpowers/2026-08-26-billing-prompt-passthrough-design.md`

## Global Constraints（规格原文约束，所有任务隐含遵守）

- 请求体字段上限：`request_id` ≤64 字符；`feature` ≤64 字符；`system_prompt` 1–4000 字符；`prompt` 1–20000 字符；`max_output_tokens` 默认 4096、范围 1–8192（规格 §3.2）
- 流前错误 = 普通 HTTP 状态码 + JSON；流开始后 = SSE `delta`/`done`/`error` 事件（§3.3）
- 幂等语义：done→重放不重扣；在途→409；失败/取消→同 id 可重入（§3.4）
- 402 → 取消该页剩余全部批次 + 充值引导；401 → 清本地会话 + 重新登录引导；502/超时 → 现有 `RequestQueue` 自动重试（**复用同一 `request_id`**）（§6.3）
- 计费通道 `RequestQueue` 速率强制为 1（对齐后端在途=1）；批次大小参数不动（§6.4）
- 取消联动：排空队列 → 对在途批调用 `POST /v1/cancel` → 中止本地流读取（§6.5）
- 免费通道（DeepL/DeepLX/Google/Microsoft）、BYOK、提示词组装、批量/缓存/重试既有逻辑、内容渲染——**一律不动**（§6.6）
- `session_id` 存 `chrome.storage.local`；退出登录调 `/logout` 并清本地；任何请求 401 即清会话（§7.5/§7.7）
- 本地跑测试 `SKIP_FREE_API=true`（AGENTS.md）；PR 用 conventional commit + changeset（AGENTS.md）

## 主持裁决记录（计划作者已定，执行者不必再议）

1. **接缝选择**：`createHostedTextPartStream` 是 6 条文本路由 + 摘要/切分/语言检测非流式收敛（`generateTextForProviderRef`）的唯一漏斗，换它一个函数体即可切换全部托管文本功能；port 消息、`consumeTextPartStream`、渲染侧零改动。
2. **customAction / noteSuggestion（结构化输出路由）不切**：billing-backend 没有结构化输出端点。这两条保留 readfrog oRPC 代码不动；账户换芯后它们实际不可用——**已知影响，不在本切片范围**（与规格 §6.6 不动清单一致）。
3. **托管可用性闸门**改为 billing 会话判定：未登录 → `HostedAiProviderUnavailableError`（登录引导文案）；**余额不在闸门查**（后端 402 兜底，规格 §6.3 路径）。
4. **UI 状态兼容**：`useHostedAiStatus` 保持 `HostedAiStatus` 返回形状（由 billing 数据**合成**），6 个消费者（provider 下拉装饰、语言检测、popup providers-field 等）零改动。
5. **并发对齐**：每个通道（webpage/subtitles）拆两个 `RequestQueue`——local/BYOK 用用户配置速率，hosted 固定 `rate=1, capacity=1`。
6. **取消联动**复用现有 abort 信号链：队列取消/选词取消/关页清扫都会 abort 在途任务的 `AbortSignal`；billing 适配器监听 abort → fire-and-forget `POST /v1/cancel`。
7. **验证码激活后自动登录**：后端 `/verify-code` 只激活不发会话，前端激活成功后立即用同邮箱+密码调 `/login` 写会话。
8. **`WXT_BILLING_API_URL`**：dev 默认 `http://localhost:8000`；prod 默认 `https://billing.meowtabby.invalid`（IANA 保留 `.invalid`，明示占位）——发版前必须以真实 HTTPS 域名覆盖（规格 §10.2 硬性要求）。
9. **402 抽干队列**：billing 错误带 `statusCode: 402` + `kind: "access-denied"`；retry-policy 的 queue-fatal 列表同时加入 402（双保险）。
10. **`modelRevision = "billing-v1"` 常量**：后端只报一个模型；缓存身份固定。后端换模型需手动升版本——已知局限。

## 文件结构总览

**新建（`src/utils/billing/`）**

| 文件                                                               | 职责                                                                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/billing/types.ts`                                       | 类型与常量：`BillingSession` / `BillingHostedStatus` / `BillingFeature` / `BillingMe` / `BillingLoginResult` / `BILLING_MODEL_REVISION`            |
| `src/utils/billing/session.ts`                                     | 会话存取：`getBillingSession` / `setBillingSession` / `clearBillingSession` / `onBillingSessionChanged`（WXT storage `local:` 前缀）               |
| `src/utils/billing/sse.ts`                                         | SSE 解析器：`readBillingSseEvents(body)` 增量解码 → `{event, data}`                                                                                |
| `src/utils/billing/rest.ts`                                        | REST 客户端 + 错误分级：`billingRegister/VerifyCode/ResendVerify/Login/Logout/ForgotPassword/ResetPassword/Me/Cancel` + `classifyBillingHttpError` |
| `src/utils/billing/generate.ts`                                    | `createBillingTextPartStream`：/v1/generate SSE → AI-SDK parts；401 清会话；abort → /v1/cancel                                                     |
| `src/utils/billing/hosted-status-adapter.ts`                       | `buildHostedAiStatusFromBilling(authenticated)`：合成 readfrog 形状给 UI 消费者                                                                    |
| `src/utils/billing/__tests__/*.test.ts`                            | 以上各模块测试（每个模块一个）                                                                                                                     |
| `src/entrypoints/options/pages/account/index.tsx`                  | 选项页 Account 页（登录/注册/验证码/找回密码/余额/充值引导/退出）                                                                                  |
| `src/entrypoints/options/pages/account/__tests__/account.test.tsx` | Account 页测试                                                                                                                                     |

**修改**

| 文件                                                                                                                                     | 改动                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/env/shared.ts`                                                                                                                      | 新增 `WXT_BILLING_API_URL`（默认值 + resolve + schema）                                            |
| `src/utils/request/retry-policy.ts`                                                                                                      | queue-fatal 列表加 402                                                                             |
| `src/entrypoints/background/background-stream.ts`                                                                                        | `createHostedTextPartStream` 换芯；删文本路由 oRPC 表；`billingTag` 透传（摘要标 `summarization`） |
| `src/types/background-stream.ts`                                                                                                         | payload 增加 `billingTag?: BillingFeature`                                                         |
| `src/types/background-generate-text.ts`                                                                                                  | payload 增加 `billingTag?: string`                                                                 |
| `src/entrypoints/background/hosted-ai-status.ts`                                                                                         | 状态源改 billing（session + /me），返回 `BillingHostedStatus`                                      |
| `src/utils/message.ts`                                                                                                                   | `getHostedAiStatus` 返回类型改 `BillingHostedStatus \| null`                                       |
| `src/utils/providers/provider-ref.ts`                                                                                                    | 闸门改会话判定；`modelRevision` 用 `BILLING_MODEL_REVISION`                                        |
| `src/entrypoints/background/translation-queues.ts`                                                                                       | 双队列拆分（hosted rate=1）；取消清扫两条队列                                                      |
| `src/utils/constants/translate.ts`                                                                                                       | `HOSTED_REQUEST_RATE` / `HOSTED_REQUEST_CAPACITY`                                                  |
| `src/components/llm-providers/use-hosted-ai-status.ts`                                                                                   | 数据源改 billing（形状不变）                                                                       |
| `src/components/user-account-menu/shared.tsx` / `popup.tsx` / `sidebar.tsx`                                                              | 账户菜单换芯（会话 + 余额 + 退出）                                                                 |
| `src/entrypoints/options/pages/api-providers/built-in-ai-usage/index.tsx`                                                                | readfrog 配额条 → 余额展示                                                                         |
| `src/components/llm-providers/provider-selector.tsx`、`src/entrypoints/options/pages/api-providers/providers-config/provider-editor.tsx` | 删除 Ultra 付费墙徽章                                                                              |
| `src/entrypoints/options/app-sidebar/nav-items.ts`、`app.tsx`、`app-sidebar/settings-nav.tsx`、`command-palette/search-items.ts`         | `/account` 路由注册                                                                                |
| `src/locales/*.yml` ×9                                                                                                                   | 新增 `billing` 键树 + `options.account`                                                            |

---

### Task 1: 环境变量 `WXT_BILLING_API_URL`

**Files:**

- Modify: `src/env/shared.ts`
- Test: `src/env/__tests__/shared.test.ts`（已存在，追加）

**Interfaces:**

- Produces: `env.WXT_BILLING_API_URL: string`（billing 后端基地址，无尾斜杠），后续所有任务消费。

- [ ] **Step 1: 写失败测试（追加到 `src/env/__tests__/shared.test.ts`）**

沿用该文件既有的 `resolveExtensionEnv` / schema 测试风格，追加：

```ts
describe("WXT_BILLING_API_URL", () => {
  it("defaults to the .invalid placeholder in production mode", () => {
    const resolved = resolveExtensionEnv({})
    expect(resolved.WXT_BILLING_API_URL).toBe("https://billing.meowtabby.invalid")
  })

  it("defaults to localhost:8000 when local packages are enabled", () => {
    const resolved = resolveExtensionEnv({ WXT_USE_LOCAL_PACKAGES: "true" })
    expect(resolved.WXT_BILLING_API_URL).toBe("http://localhost:8000")
  })

  it("prefers the raw env value over defaults", () => {
    const resolved = resolveExtensionEnv({ WXT_BILLING_API_URL: "https://billing.example.com" })
    expect(resolved.WXT_BILLING_API_URL).toBe("https://billing.example.com")
  })

  it("rejects a trailing slash", () => {
    const schema = z.object(createExtensionClientEnvSchema(false))
    const parsed = schema.safeParse(
      resolveExtensionEnv({ WXT_BILLING_API_URL: "https://billing.example.com/" }),
    )
    expect(parsed.success).toBe(false)
  })
})
```

（文件顶部若尚未导入 `z` 与 `createExtensionClientEnvSchema`，按该文件现有导入风格补上。）

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/Luo_F/vs_code/MeowTabby && pnpm vitest run src/env/__tests__/shared.test.ts`
Expected: 新增 4 例 FAIL（`WXT_BILLING_API_URL` 不存在）。

- [ ] **Step 3: 实现**

`src/env/shared.ts` 三处：

```ts
export const PRODUCTION_EXTENSION_ENV_DEFAULTS = {
  WXT_API_URL: "https://api.readfrog.app",
  WXT_WEBSITE_URL: "https://www.readfrog.app",
  WXT_OFFICIAL_SITE_ORIGINS: "https://readfrog.app,https://www.readfrog.app",
  WXT_AUTH_COOKIE_DOMAINS: "readfrog.app",
  // .invalid 是 IANA 保留 TLD：明示占位，发版前必须以真实 HTTPS 域名覆盖
  WXT_BILLING_API_URL: "https://billing.meowtabby.invalid",
} as const

export const LOCAL_EXTENSION_ENV_DEFAULTS = {
  WXT_API_URL: "https://localhost:4433",
  WXT_WEBSITE_URL: "https://localhost:8877",
  WXT_OFFICIAL_SITE_ORIGINS: "http://localhost:8888,https://localhost:8877",
  WXT_AUTH_COOKIE_DOMAINS: "localhost",
  WXT_BILLING_API_URL: "http://localhost:8000",
} as const
```

`resolveExtensionEnv` 返回对象追加：

```ts
    WXT_BILLING_API_URL: rawEnv.WXT_BILLING_API_URL ?? defaults.WXT_BILLING_API_URL,
```

`createExtensionClientEnvSchema` 返回对象追加（`WXT_API_URL` 之后）：

```ts
    WXT_BILLING_API_URL: strictUrlSchema,
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run src/env/__tests__/shared.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/env/shared.ts src/env/__tests__/shared.test.ts
git commit -m "feat(billing): add WXT_BILLING_API_URL env with fail-loud prod default"
```

---

### Task 2: billing 类型与会话存储

**Files:**

- Create: `src/utils/billing/types.ts`
- Create: `src/utils/billing/session.ts`
- Test: `src/utils/billing/__tests__/session.test.ts`

**Interfaces:**

- Produces: `BillingSession`、`BillingHostedStatus`、`BillingFeature`、`BillingMe`、`BillingLoginResult`、`BillingRecentCall`、`BILLING_MODEL_REVISION`（types.ts）；`BILLING_SESSION_STORAGE_KEY`、`getBillingSession(): Promise<BillingSession | null>`、`setBillingSession(input: Omit<BillingSession, "signedInAt">): Promise<BillingSession>`、`clearBillingSession(): Promise<void>`、`onBillingSessionChanged(cb: (session: BillingSession | null) => void): () => void`（session.ts）。

- [ ] **Step 1: 写 types.ts（无行为，不含测试循环）**

```ts
// src/utils/billing/types.ts

/** billing-backend 功能标签（规格 §3.2，服务端只存储不解析）。 */
export type BillingFeature =
  | "pageTranslation"
  | "selectionTranslation"
  | "inputTranslation"
  | "videoSubtitles"
  | "videoSubtitlesSegmentation"
  | "languageDetection"
  | "summarization"

export interface BillingSession {
  sessionId: string
  email: string
  displayName: string | null
  signedInAt: number
}

/** 背景托管 AI 可用性判定（替代 readfrog hostedAi.status）。 */
export interface BillingHostedStatus {
  authenticated: boolean
  /** /me 的元字符串（4 位小数，如 "12.3400"）；null = 未知 */
  balanceYuan: string | null
  email: string | null
}

/**
 * 后端只有一个模型，缓存身份固定。后端换模型时手动升版本，
 * 让既有翻译缓存整体失效重算。
 */
export const BILLING_MODEL_REVISION = "billing-v1"

export interface BillingRecentCall {
  id: number
  timestamp: string
  ok: boolean
  total_tokens: number
  cache_hit: number
  cache_miss: number
  latency_ms: number
  cost: string
  error: string | null
}

export interface BillingMe {
  user_id: string
  email: string
  display_name: string | null
  email_verified: boolean
  balance: string
  total_recharged: string
  total_spent: string
  total_tokens: number
  recent_calls: BillingRecentCall[]
}

export interface BillingLoginResult {
  session_id: string
  user_id: string
  expires_in_days: number
}
```

- [ ] **Step 2: 写失败测试**

```ts
// src/utils/billing/__tests__/session.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const getItemMock = vi.fn<(...args: any[]) => any>()
const setItemMock = vi.fn<(...args: any[]) => any>()
const removeItemMock = vi.fn<(...args: any[]) => any>()
const watchMock = vi.fn<(...args: any[]) => any>().mockReturnValue(() => {})

vi.mock("#imports", () => ({
  storage: {
    getItem: getItemMock,
    setItem: setItemMock,
    removeItem: removeItemMock,
    watch: watchMock,
  },
}))
vi.mock("wxt/utils/storage", () => ({
  storage: {
    getItem: getItemMock,
    setItem: setItemMock,
    removeItem: removeItemMock,
    watch: watchMock,
  },
}))

import {
  BILLING_SESSION_STORAGE_KEY,
  clearBillingSession,
  getBillingSession,
  onBillingSessionChanged,
  setBillingSession,
} from "../session"

const FULL_KEY = `local:${BILLING_SESSION_STORAGE_KEY}`

beforeEach(() => {
  vi.clearAllMocks()
  watchMock.mockReturnValue(() => {})
})

describe("getBillingSession", () => {
  it("returns null when nothing is stored", async () => {
    getItemMock.mockResolvedValue(null)
    expect(await getBillingSession()).toBeNull()
    expect(getItemMock).toHaveBeenCalledWith(FULL_KEY)
  })

  it("returns the stored session", async () => {
    const session = { sessionId: "s1", email: "a@b.c", displayName: null, signedInAt: 1 }
    getItemMock.mockResolvedValue(session)
    expect(await getBillingSession()).toEqual(session)
  })

  it("returns null for a malformed entry", async () => {
    getItemMock.mockResolvedValue({ email: "a@b.c" })
    expect(await getBillingSession()).toBeNull()
  })

  it("returns null when storage throws", async () => {
    getItemMock.mockRejectedValue(new Error("boom"))
    expect(await getBillingSession()).toBeNull()
  })
})

describe("setBillingSession", () => {
  it("stores the session with a fresh signedInAt", async () => {
    const stored = await setBillingSession({ sessionId: "s1", email: "a@b.c", displayName: "N" })
    expect(stored.sessionId).toBe("s1")
    expect(typeof stored.signedInAt).toBe("number")
    expect(setItemMock).toHaveBeenCalledWith(FULL_KEY, stored)
  })
})

describe("clearBillingSession", () => {
  it("removes the storage key", async () => {
    await clearBillingSession()
    expect(removeItemMock).toHaveBeenCalledWith(FULL_KEY)
  })
})

describe("onBillingSessionChanged", () => {
  it("forwards storage.watch values and returns an unwatch", () => {
    const callback = vi.fn()
    const unwatch = vi.fn()
    watchMock.mockReturnValue(unwatch)
    const dispose = onBillingSessionChanged(callback)
    expect(watchMock).toHaveBeenCalledWith(FULL_KEY, expect.any(Function))
    const registered = watchMock.mock.calls[0][1]
    registered({ sessionId: "s2" })
    registered(undefined)
    expect(callback).toHaveBeenNthCalledWith(1, { sessionId: "s2" })
    expect(callback).toHaveBeenNthCalledWith(2, null)
    dispose()
    expect(unwatch).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm vitest run src/utils/billing/__tests__/session.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 session.ts**

```ts
// src/utils/billing/session.ts
import type { BillingSession } from "./types"
import { storage } from "#imports"

/** chrome.storage.local（`local:` 前缀）——规格 §7.5。 */
export const BILLING_SESSION_STORAGE_KEY = "meowtabby-billing-session"

const STORAGE_KEY = `local:${BILLING_SESSION_STORAGE_KEY}`

export async function getBillingSession(): Promise<BillingSession | null> {
  try {
    const session = await storage.getItem<BillingSession>(STORAGE_KEY)
    if (!session || typeof session.sessionId !== "string" || session.sessionId.length === 0) {
      return null
    }
    return session
  } catch {
    return null
  }
}

export async function setBillingSession(
  input: Omit<BillingSession, "signedInAt">,
): Promise<BillingSession> {
  const session: BillingSession = { ...input, signedInAt: Date.now() }
  await storage.setItem(STORAGE_KEY, session)
  return session
}

export async function clearBillingSession(): Promise<void> {
  await storage.removeItem(STORAGE_KEY)
}

export function onBillingSessionChanged(
  callback: (session: BillingSession | null) => void,
): () => void {
  return storage.watch<BillingSession>(STORAGE_KEY, (newValue) => {
    callback(newValue ?? null)
  })
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm vitest run src/utils/billing/__tests__/session.test.ts`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/utils/billing/types.ts src/utils/billing/session.ts src/utils/billing/__tests__/session.test.ts
git commit -m "feat(billing): session types and chrome.storage.local session store"
```

---

### Task 3: SSE 解析器

**Files:**

- Create: `src/utils/billing/sse.ts`
- Test: `src/utils/billing/__tests__/sse.test.ts`

**Interfaces:**

- Produces: `interface BillingSseEvent { event: string; data: string }`；`readBillingSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<BillingSseEvent>`。generate.ts（Task 6）消费。

- [ ] **Step 1: 写失败测试**

```ts
// src/utils/billing/__tests__/sse.test.ts
import { describe, expect, it } from "vitest"
import { readBillingSseEvents } from "../sse"

function streamFromRawChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const events = []
  for await (const event of readBillingSseEvents(stream)) events.push(event)
  return events
}

describe("readBillingSseEvents", () => {
  it("parses delta and done events", async () => {
    const stream = streamFromRawChunks([
      'event: delta\ndata: {"text":"Hello"}\n\n',
      'event: done\ndata: {"cost":"0.00000300"}\n\n',
    ])
    expect(await collect(stream)).toEqual([
      { event: "delta", data: '{"text":"Hello"}' },
      { event: "done", data: '{"cost":"0.00000300"}' },
    ])
  })

  it("ignores heartbeat comments", async () => {
    const stream = streamFromRawChunks([": keep-alive\n\n", "event: done\ndata: {}\n\n"])
    expect(await collect(stream)).toEqual([{ event: "done", data: "{}" }])
  })

  it("handles chunk boundaries inside a line", async () => {
    const stream = streamFromRawChunks(["event: del", 'ta\ndata: {"te', 'xt":"x"}\n\n'])
    expect(await collect(stream)).toEqual([{ event: "delta", data: '{"text":"x"}' }])
  })

  it("handles a multibyte character split across chunks", async () => {
    const encoded = new TextEncoder().encode('data: {"text":"译"}\n\n')
    const splitAt = encoded.indexOf(0xe8) // UTF-8 首字节处切开
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, splitAt))
        controller.enqueue(encoded.slice(splitAt))
        controller.close()
      },
    })
    expect(await collect(stream)).toEqual([{ event: "message", data: '{"text":"译"}' }])
  })

  it("joins multiline data fields with newlines", async () => {
    const stream = streamFromRawChunks(["data: line1\ndata: line2\n\n"])
    expect(await collect(stream)).toEqual([{ event: "message", data: "line1\nline2" }])
  })

  it("supports CRLF line endings", async () => {
    const stream = streamFromRawChunks(["event: done\r\ndata: {}\r\n\r\n"])
    expect(await collect(stream)).toEqual([{ event: "done", data: "{}" }])
  })

  it("resets event name after dispatch", async () => {
    const stream = streamFromRawChunks(["event: delta\ndata: a\n\ndata: b\n\n"])
    expect(await collect(stream)).toEqual([
      { event: "delta", data: "a" },
      { event: "message", data: "b" },
    ])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/utils/billing/__tests__/sse.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/utils/billing/sse.ts

export interface BillingSseEvent {
  event: string
  data: string
}

/**
 * 增量 SSE 解析：任意字节边界（含多字节字符切半）安全。
 * 注释行（`:` 开头，后端 15s 心跳）忽略；空行分发一帧；
 * 未以空行收尾的残帧在流末尾兜底分发（后端恒以 \n\n 收尾，此为防御）。
 */
export async function* readBillingSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<BillingSseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let eventName = ""
  let dataLines: string[] = []

  function* drainBuffer(flush: boolean): Generator<BillingSseEvent> {
    let newlineIndex = buffer.indexOf("\n")
    while (newlineIndex !== -1) {
      const rawLine = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
      if (line === "") {
        if (dataLines.length > 0) {
          yield { event: eventName || "message", data: dataLines.join("\n") }
        }
        eventName = ""
        dataLines = []
      } else if (!line.startsWith(":")) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).replace(/^ /, "")
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).replace(/^ /, ""))
        }
      }
      newlineIndex = buffer.indexOf("\n")
    }
    if (flush && dataLines.length > 0) {
      yield { event: eventName || "message", data: dataLines.join("\n") }
      eventName = ""
      dataLines = []
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      yield* drainBuffer(false)
    }
    buffer += decoder.decode()
    yield* drainBuffer(true)
  } finally {
    reader.releaseLock()
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run src/utils/billing/__tests__/sse.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/utils/billing/sse.ts src/utils/billing/__tests__/sse.test.ts
git commit -m "feat(billing): byte-boundary-safe SSE stream parser"
```

---

### Task 4: REST 客户端与错误分级

**Files:**

- Create: `src/utils/billing/rest.ts`
- Test: `src/utils/billing/__tests__/rest.test.ts`

**Interfaces:**

- Consumes: `env.WXT_BILLING_API_URL`（Task 1）；`clearBillingSession`（Task 2）；`attachRequestErrorMeta`（既有 `src/utils/request/retry-policy.ts`）；`BillingMe` / `BillingLoginResult`（Task 2）。
- Produces: `BillingApiError`、`classifyBillingHttpError(status, message): BillingApiError`、`billingRegister/VerifyCode/ResendVerify/Login/Logout/ForgotPassword/ResetPassword/Me/Cancel`。generate.ts（Task 6）用 `billingCancel` + `BillingApiError`；账户页（Task 11）用全部；状态源（Task 9）用 `billingMe`。

- [ ] **Step 1: 写失败测试**

```ts
// src/utils/billing/__tests__/rest.test.ts
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"
import { getRequestErrorMeta } from "@/utils/request/retry-policy"

vi.mock("@/utils/billing/session", () => ({
  clearBillingSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/env", () => ({
  env: { WXT_BILLING_API_URL: "https://billing.test" },
}))

import { clearBillingSession } from "@/utils/billing/session"
import {
  BillingApiError,
  billingCancel,
  billingLogin,
  billingMe,
  billingRegister,
  billingResetPassword,
  classifyBillingHttpError,
} from "../rest"

const fetchMock = vi.fn<(...args: any[]) => any>()

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: vi.fn<(...args: any[]) => any>().mockResolvedValue(body),
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.mocked(clearBillingSession).mockClear()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("request shapes", () => {
  it("registers with display_name and posts JSON", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { message: "ok", user_id: "u1", mail_sent: true }),
    )
    await billingRegister({ email: "a@b.c", password: "password1", displayName: "妮称" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://billing.test/register")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      email: "a@b.c",
      password: "password1",
      display_name: "妮称",
    })
  })

  it("attaches Bearer session on /me GET", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        user_id: "u1",
        email: "a@b.c",
        display_name: null,
        email_verified: true,
        balance: "1.0000",
        total_recharged: "1.0000",
        total_spent: "0.0000",
        total_tokens: 0,
        recent_calls: [],
      }),
    )
    await billingMe("sess-1")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://billing.test/me")
    expect(init.method).toBe("GET")
    expect(init.headers.Authorization).toBe("Bearer sess-1")
  })

  it("sends request_id to /v1/cancel", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { message: "ok" }))
    await billingCancel("sess-1", "rid-1")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://billing.test/v1/cancel")
    expect(init.headers.Authorization).toBe("Bearer sess-1")
    expect(JSON.parse(init.body)).toEqual({ request_id: "rid-1" })
  })

  it("maps reset-password field names", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { message: "ok" }))
    await billingResetPassword({ email: "a@b.c", code: "123456", newPassword: "password2" })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: "a@b.c",
      code: "123456",
      new_password: "password2",
    })
  })
})

describe("error handling", () => {
  it("clears the session on 401 and throws classified error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: "会话不存在或已过期" }))
    await expect(billingMe("bad")).rejects.toMatchObject({ status: 401 })
    expect(clearBillingSession).toHaveBeenCalledTimes(1)
  })

  it("surfaces the server detail message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { detail: "该邮箱已注册" }))
    await expect(billingRegister({ email: "a@b.c", password: "password1" })).rejects.toThrow(
      "该邮箱已注册",
    )
  })

  it("classifies a network failure as retryable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    const promise = billingLogin({ email: "a@b.c", password: "password1" })
    await expect(promise).rejects.toMatchObject({ name: "BillingApiError" })
    await expect(billingLogin({ email: "a@b.c", password: "password1" })).rejects.toSatisfy(
      (error: unknown) => getRequestErrorMeta(error).kind === "network",
    )
  })
})

describe("classifyBillingHttpError", () => {
  it.each([
    [401, "access-denied", false],
    [402, "access-denied", false],
    [429, "rate-limit", true],
    [422, "bad-request", false],
    [503, "unknown", true],
  ] as const)("status %i → kind %s retryable %s", (status, kind, isRetryable) => {
    const meta = getRequestErrorMeta(classifyBillingHttpError(status, "x"))
    expect(meta.statusCode).toBe(status)
    expect(meta.kind).toBe(kind)
    expect(meta.isRetryable).toBe(isRetryable)
  })

  it("is a BillingApiError carrying the message", () => {
    const error = classifyBillingHttpError(402, "余额不足")
    expect(error).toBeInstanceOf(BillingApiError)
    expect(error.message).toBe("余额不足")
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/utils/billing/__tests__/rest.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 rest.ts**

```ts
// src/utils/billing/rest.ts
import type { BillingLoginResult, BillingMe } from "./types"
import { env } from "@/env"
import { i18n } from "@/utils/i18n"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"
import { clearBillingSession } from "./session"

export class BillingApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "BillingApiError"
  }
}

/**
 * HTTP 状态 → 队列语义。挂在 RequestErrorMeta 上，供
 * defaultRequestRetryPolicy 裁决：401/402 抽干队列，429 暂停重试，
 * 5xx 普通重试（幂等键由调用方复用兜底）。
 */
export function classifyBillingHttpError(status: number, message: string): BillingApiError {
  const error = new BillingApiError(status, message)
  switch (status) {
    case 401:
    case 402:
      return attachRequestErrorMeta(error, {
        statusCode: status,
        kind: "access-denied",
        isRetryable: false,
      })
    case 429:
      return attachRequestErrorMeta(error, {
        statusCode: 429,
        kind: "rate-limit",
        isRetryable: true,
      })
    case 422:
      return attachRequestErrorMeta(error, {
        statusCode: 422,
        kind: "bad-request",
        isRetryable: false,
      })
    default:
      break
  }
  if (status >= 500 || status === 0) {
    return attachRequestErrorMeta(error, {
      statusCode: status || undefined,
      kind: status === 0 ? "network" : "unknown",
      isRetryable: true,
    })
  }
  return attachRequestErrorMeta(error, {
    statusCode: status,
    kind: "bad-request",
    isRetryable: false,
  })
}

interface BillingFetchOptions {
  method?: "GET" | "POST"
  body?: unknown
  sessionId?: string
}

async function billingJson<T>(path: string, options: BillingFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (options.sessionId) {
    headers.Authorization = `Bearer ${options.sessionId}`
  }

  let response: Response
  try {
    response = await fetch(`${env.WXT_BILLING_API_URL}${path}`, {
      method: options.method ?? "POST",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw classifyBillingHttpError(0, i18n.t("billing.errors.network"))
  }

  // 401 = 会话失效：本地立即清除，任何后续 UI 统一回落到未登录态（规格 §7.7）
  if (response.status === 401) {
    void clearBillingSession()
  }

  if (!response.ok) {
    let detail: string | undefined
    try {
      const parsed = (await response.json()) as { detail?: unknown }
      if (typeof parsed.detail === "string" && parsed.detail) {
        detail = parsed.detail
      }
    } catch {
      // 非 JSON 错误体：退回 statusText
    }
    throw classifyBillingHttpError(response.status, detail ?? response.statusText)
  }

  return (await response.json()) as T
}

export const billingRegister = (input: { email: string; password: string; displayName?: string }) =>
  billingJson<{ message: string; user_id: string; mail_sent: boolean }>("/register", {
    body: { email: input.email, password: input.password, display_name: input.displayName ?? "" },
  })

export const billingVerifyCode = (input: { email: string; code: string }) =>
  billingJson<{ message: string }>("/verify-code", { body: input })

export const billingResendVerify = (email: string) =>
  billingJson<{ message: string }>("/resend-verify", { body: { email } })

export const billingLogin = (input: { email: string; password: string }) =>
  billingJson<BillingLoginResult>("/login", { body: input })

export const billingLogout = (sessionId: string) =>
  billingJson<{ message: string }>("/logout", { sessionId })

export const billingForgotPassword = (email: string) =>
  billingJson<{ message: string }>("/forgot-password", { body: { email } })

export const billingResetPassword = (input: { email: string; code: string; newPassword: string }) =>
  billingJson<{ message: string }>("/reset-password", {
    body: { email: input.email, code: input.code, new_password: input.newPassword },
  })

export const billingMe = (sessionId: string) =>
  billingJson<BillingMe>("/me", { method: "GET", sessionId })

export const billingCancel = (sessionId: string, requestId: string) =>
  billingJson<{ message: string }>("/v1/cancel", { body: { request_id: requestId }, sessionId })
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run src/utils/billing/__tests__/rest.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/utils/billing/rest.ts src/utils/billing/__tests__/rest.test.ts
git commit -m "feat(billing): REST client with retry-policy error classification"
```

---

### Task 5: i18n 键树（9 语言）

**Files:**

- Modify: `src/locales/en.yml`、`src/locales/zh-CN.yml`、`src/locales/zh-TW.yml`、`src/locales/ja.yml`、`src/locales/ko.yml`、`src/locales/es.yml`、`src/locales/ru.yml`、`src/locales/tr.yml`、`src/locales/vi.yml`

**Interfaces:**

- Produces: `billing.*` 键树与 `options.account.*` 键。后续 Task 6/8/11/12 的代码 `i18n.t(...)` 引用这些键；类型门（`pnpm lint`）以 en.yml 为基准生成。

- [ ] **Step 1: en.yml 增加顶层 `billing` 树**

在 `account:` 块之后插入（保持两空格缩进）：

```yaml
billing:
  errors:
    network: Network error, please try again later.
    balanceInsufficient: Balance insufficient. Please recharge.
    sessionExpired: Your session has expired. Please log in again.
    generic: Request failed, please try again later.
  account:
    title: Account
    description: Log in, register, and manage your translation balance
    balance: Balance
    recharge: Recharge
    rechargeGuide: To recharge your account, please contact the administrator. Self-service payment will be available in a future release.
    notLoggedIn: Not logged in
    loginOrRegister: Log in or register to use built-in AI translation
  login:
    title: Log in
    email: Email
    password: Password
    submit: Log in
    forgotPassword: Forgot password?
    switchToRegister: Create an account
  register:
    title: Register
    displayName: Nickname
    email: Email
    password: Password
    submit: Register
    switchToLogin: Already have an account? Log in
    codeTitle: Enter verification code
    codeDescription: A 6-digit verification code has been sent to $1 (valid for 10 minutes)
    code: Verification code
    verify: Verify and activate
    resend: Resend code
    resendSuccess: A new verification code has been sent
  reset:
    title: Reset password
    requestDescription: Enter your account email and we will send you a verification code.
    sendCode: Send code
    codeSent: A verification code has been sent to $1
    code: Verification code
    newPassword: New password
    submit: Reset password
    backToLogin: Back to login
    success: Password reset. Please log in with your new password.
```

- [ ] **Step 2: en.yml 的 `options:` 树下增加 `account` 键**

在 `options:` 块内（与 `sidebar:` 等同级）插入：

```yaml
account:
  title: Account
  description: Log in, register, and manage your balance
```

（search-items 的 `titleKey`/`descriptionKey`/`pageKey` 将引用 `options.account.title` / `options.account.description`。）

- [ ] **Step 3: zh-CN.yml 同样位置插入中文树**

```yaml
billing:
  errors:
    network: 网络错误，请稍后重试
    balanceInsufficient: 余额不足，请充值
    sessionExpired: 登录已过期，请重新登录
    generic: 请求失败，请稍后重试
  account:
    title: 账户
    description: 登录、注册并管理翻译余额
    balance: 余额
    recharge: 充值
    rechargeGuide: 请联系管理员为你的账户充值，后续版本将支持自助支付。
    notLoggedIn: 未登录
    loginOrRegister: 登录或注册后使用内置 AI 翻译
  login:
    title: 登录
    email: 邮箱
    password: 密码
    submit: 登录
    forgotPassword: 忘记密码？
    switchToRegister: 注册新账号
  register:
    title: 注册
    displayName: 昵称
    email: 邮箱
    password: 密码
    submit: 注册
    switchToLogin: 已有账号？去登录
    codeTitle: 输入验证码
    codeDescription: 6 位验证码已发送至 $1（10 分钟内有效）
    code: 验证码
    verify: 验证并激活
    resend: 重新发送
    resendSuccess: 新验证码已发送
  reset:
    title: 重置密码
    requestDescription: 输入账号邮箱，我们将发送验证码。
    sendCode: 发送验证码
    codeSent: 验证码已发送至 $1
    code: 验证码
    newPassword: 新密码
    submit: 重置密码
    backToLogin: 返回登录
    success: 密码已重置，请使用新密码登录
```

以及 `options:` 下：

```yaml
account:
  title: 账户
  description: 登录、注册并管理余额
```

- [ ] **Step 4: 其余 7 个语言文件**

`zh-TW.yml`、`ja.yml`、`ko.yml`、`es.yml`、`ru.yml`、`tr.yml`、`vi.yml`：在同样位置插入 **Step 1/Step 2 的 en 键树原文**（本切片不阻塞翻译，后续可人工本地化）。逐文件确认 `billing:` 顶层键唯一、`options.account` 无重复。

- [ ] **Step 5: 验证键树生效**

Run: `pnpm vitest run src/utils/i18n 2>/dev/null || true; node -e "const y=require('js-yaml');const fs=require('fs');for (const f of ['en','zh-CN']){const d=y.load(fs.readFileSync('src/locales/'+f+'.yml','utf8'));if(!d.billing?.login?.title||!d.options?.account?.title)throw new Error(f+' missing keys');console.log(f+' ok')}"`

若仓库未装 `js-yaml` 可执行脚本，改用：`grep -n "^billing:" src/locales/en.yml src/locales/zh-CN.yml && grep -c "switchToRegister" src/locales/*.yml`（9 个文件都应命中）。
Expected: en/zh-CN 结构完整，9 文件均含新键。

- [ ] **Step 6: Commit**

```bash
git add src/locales/*.yml
git commit -m "feat(billing): i18n keys for account flows and billing errors"
```

---

### Task 6: billing 流式生成器（运输层核心）

**Files:**

- Create: `src/utils/billing/generate.ts`
- Test: `src/utils/billing/__tests__/generate.test.ts`

**Interfaces:**

- Consumes: `getBillingSession`/`clearBillingSession`（Task 2）；`readBillingSseEvents`（Task 3）；`BillingApiError`/`classifyBillingHttpError`/`billingCancel`（Task 4）；`env.WXT_BILLING_API_URL`（Task 1）；`BillingFeature`（Task 2）；i18n 键（Task 5）。
- Produces: `interface BillingGenerateInput { systemPrompt: string; prompt: string; requestId: string; feature: BillingFeature; maxOutputTokens?: number }`；`createBillingTextPartStream(input: BillingGenerateInput, signal?: AbortSignal): Promise<AsyncIterable<Record<string, unknown>>>`——yield `{type:"text-delta", text}` 与 `{type:"finish", finishReason:"stop"}`（与 `consumeTextPartStream` 兼容），中途错误抛带 RequestErrorMeta 的 `BillingApiError`。Task 8 消费。

- [ ] **Step 1: 写失败测试**

```ts
// src/utils/billing/__tests__/generate.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getRequestErrorMeta } from "@/utils/request/retry-policy"

vi.mock("@/env", () => ({
  env: { WXT_BILLING_API_URL: "https://billing.test" },
}))

import { clearBillingSession, getBillingSession } from "../session"
import { createBillingTextPartStream } from "../generate"

vi.mock("../session", () => ({
  getBillingSession: vi.fn(),
  clearBillingSession: vi.fn().mockResolvedValue(undefined),
}))

const fetchMock = vi.fn<(...args: any[]) => any>()

function sseResponse(sseText: string, status = 200) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseText))
      controller.close()
    },
  })
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    body: stream,
    json: vi.fn<(...args: any[]) => any>().mockResolvedValue({ detail: "" }),
  }
}

const INPUT = {
  systemPrompt: "sys",
  prompt: "hello",
  requestId: "rid-1",
  feature: "pageTranslation" as const,
}

async function collect(iterable: AsyncIterable<Record<string, unknown>>) {
  const parts = []
  for await (const part of iterable) parts.push(part)
  return parts
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.mocked(getBillingSession).mockReset()
  vi.mocked(clearBillingSession).mockClear()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createBillingTextPartStream", () => {
  it("throws an access-denied 401 when no session is stored", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    await expect(createBillingTextPartStream(INPUT)).rejects.toSatisfy((error: unknown) => {
      const meta = getRequestErrorMeta(error)
      return meta.statusCode === 401 && meta.kind === "access-denied"
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("posts the contract body and bearer token", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    fetchMock.mockResolvedValue(sseResponse("event: done\ndata: {}\n\n"))
    await collect(await createBillingTextPartStream({ ...INPUT, maxOutputTokens: 1024 }))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://billing.test/v1/generate")
    expect(init.headers.Authorization).toBe("Bearer sess-1")
    expect(JSON.parse(init.body)).toEqual({
      request_id: "rid-1",
      feature: "pageTranslation",
      system_prompt: "sys",
      prompt: "hello",
      max_output_tokens: 1024,
    })
  })

  it("yields text-delta parts then finish", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    fetchMock.mockResolvedValue(
      sseResponse(
        'event: delta\ndata: {"text":"你好"}\n\nevent: delta\ndata: {"text":"，世界"}\n\nevent: done\ndata: {"cost":"0.00000300"}\n\n',
      ),
    )
    const parts = await collect(await createBillingTextPartStream(INPUT))
    expect(parts).toEqual([
      { type: "text-delta", text: "你好" },
      { type: "text-delta", text: "，世界" },
      { type: "finish", finishReason: "stop" },
    ])
  })

  it("classifies a 402 before the stream as access-denied", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      statusText: "Payment Required",
      body: null,
      json: vi.fn<(...args: any[]) => any>().mockResolvedValue({ detail: "余额不足" }),
    })
    await expect(createBillingTextPartStream(INPUT)).rejects.toSatisfy((error: unknown) => {
      const meta = getRequestErrorMeta(error)
      return meta.statusCode === 402 && meta.kind === "access-denied"
    })
  })

  it("clears the session on a 401 before the stream", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      body: null,
      json: vi.fn<(...args: any[]) => any>().mockResolvedValue({ detail: "会话已过期" }),
    })
    await expect(createBillingTextPartStream(INPUT)).rejects.toMatchObject({ status: 401 })
    expect(clearBillingSession).toHaveBeenCalled()
  })

  it("throws on an in-stream error event", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    fetchMock.mockResolvedValue(
      sseResponse(
        'event: delta\ndata: {"text":"半"}\n\nevent: error\ndata: {"detail":"上游调用失败"}\n\n',
      ),
    )
    const iterable = await createBillingTextPartStream(INPUT)
    await expect(collect(iterable)).rejects.toThrow("上游调用失败")
  })

  it("fires /v1/cancel when the signal aborts", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    // 永不结束的流：挂起的 read 让 abort 成为唯一的退出路径
    let cancelRead: (() => void) | undefined
    const hanging = new ReadableStream<Uint8Array>({
      start(controller) {
        cancelRead = () => controller.close()
      },
    })
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/v1/cancel")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({ message: "ok" }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, statusText: "OK", body: hanging })
    })
    const controller = new AbortController()
    const iterable = await createBillingTextPartStream(INPUT, controller.signal)
    const reader = (async () => {
      try {
        for await (const _ of iterable) {
          /* drain */
        }
      } catch {
        /* abort 预期抛错 */
      }
    })()
    controller.abort()
    await vi.waitFor(() => {
      const cancelCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/v1/cancel"))
      expect(cancelCalls).toHaveLength(1)
      expect(JSON.parse(cancelCalls[0][1].body)).toEqual({ request_id: "rid-1" })
    })
    cancelRead?.()
    await reader
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/utils/billing/__tests__/generate.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 generate.ts**

```ts
// src/utils/billing/generate.ts
import type { BillingFeature } from "./types"
import { env } from "@/env"
import { i18n } from "@/utils/i18n"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"
import { BillingApiError, billingCancel, classifyBillingHttpError } from "./rest"
import { readBillingSseEvents } from "./sse"
import { clearBillingSession, getBillingSession } from "./session"

export interface BillingGenerateInput {
  systemPrompt: string
  prompt: string
  requestId: string
  feature: BillingFeature
  maxOutputTokens?: number
}

async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const parsed = (await response.json()) as { detail?: unknown }
    return typeof parsed.detail === "string" && parsed.detail ? parsed.detail : undefined
  } catch {
    return undefined
  }
}

function parseJsonField<T>(data: string, field: string): T | undefined {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>
    return parsed[field] as T | undefined
  } catch {
    return undefined
  }
}

/**
 * 对 billing-backend 的 /v1/generate 发 SSE 请求，产出与
 * `consumeTextPartStream` 兼容的 parts 流。规格 §6.1 的运输层替换核心：
 * - 未登录 → 401 access-denied（闸门文案）
 * - 流前 HTTP 错误 → classifyBillingHttpError（402/401/429/5xx 各自语义）
 * - 流中 `error` 事件 → 抛错（重试由 RequestQueue 用同一 requestId 兜底）
 * - abort → 通知后端掐上游（规格 §6.5；后端按已生成部分结算）
 */
export async function createBillingTextPartStream(
  input: BillingGenerateInput,
  signal?: AbortSignal,
): Promise<AsyncIterable<Record<string, unknown>>> {
  const session = await getBillingSession()
  if (!session) {
    throw classifyBillingHttpError(401, i18n.t("hostedAi.availability.authenticationRequired"))
  }

  let response: Response
  try {
    response = await fetch(`${env.WXT_BILLING_API_URL}/v1/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${session.sessionId}`,
      },
      body: JSON.stringify({
        request_id: input.requestId,
        feature: input.feature,
        system_prompt: input.systemPrompt,
        prompt: input.prompt,
        ...(input.maxOutputTokens !== undefined
          ? { max_output_tokens: input.maxOutputTokens }
          : {}),
      }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) {
      throw new DOMException("stream aborted", "AbortError")
    }
    throw classifyBillingHttpError(0, i18n.t("billing.errors.network"))
  }

  if (!response.ok) {
    if (response.status === 401) {
      await clearBillingSession()
      throw classifyBillingHttpError(401, i18n.t("billing.errors.sessionExpired"))
    }
    const detail = await readErrorDetail(response)
    if (response.status === 402) {
      throw classifyBillingHttpError(402, detail ?? i18n.t("billing.errors.balanceInsufficient"))
    }
    throw classifyBillingHttpError(response.status, detail ?? response.statusText)
  }

  if (!response.body) {
    throw classifyBillingHttpError(502, i18n.t("billing.errors.generic"))
  }

  const sessionId = session.sessionId
  const requestId = input.requestId
  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        void billingCancel(sessionId, requestId).catch(() => {
          // 取消是尽力而为：后端在途=1 且有超时兜底，失败不升级为用户错误
        })
      },
      { once: true },
    )
  }

  const events = readBillingSseEvents(response.body)
  return (async function* () {
    for await (const sseEvent of events) {
      if (signal?.aborted) {
        throw new DOMException("stream aborted", "AbortError")
      }
      switch (sseEvent.event) {
        case "delta": {
          const text = parseJsonField<string>(sseEvent.data, "text")
          yield { type: "text-delta", text: typeof text === "string" ? text : "" }
          break
        }
        case "done": {
          yield { type: "finish", finishReason: "stop" }
          break
        }
        case "error": {
          const detail = parseJsonField<string>(sseEvent.data, "detail")
          throw attachRequestErrorMeta(
            new BillingApiError(502, detail || i18n.t("billing.errors.generic")),
            { statusCode: 502, kind: "unknown", isRetryable: true },
          )
        }
        default:
          break
      }
    }
  })()
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run src/utils/billing/__tests__/generate.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/utils/billing/generate.ts src/utils/billing/__tests__/generate.test.ts
git commit -m "feat(billing): SSE generate transport with cancel-on-abort"
```

---

### Task 7: retry-policy 将 402 列为队列致命错误

**Files:**

- Modify: `src/utils/request/retry-policy.ts`（`isQueueFatalRequestErrorMeta`）
- Test: `src/utils/request/__tests__/retry-policy.test.ts`（已存在，追加）

**Interfaces:**

- Consumes: 无（纯策略）。
- Produces: `statusCode 402` 的错误裁决为 `{action:"fail", failQueue:true}` → `RequestQueue.failCurrentBacklog` 抽干同队列全部积压批次（规格 §6.3 的"取消该页面剩余全部批次"）。

- [ ] **Step 1: 写失败测试（追加）**

沿用该测试文件既有的 context 构造风格追加：

```ts
describe("billing payment-required (402)", () => {
  it("fails the task and drains the queue", () => {
    const error = attachRequestErrorMeta(new Error("余额不足"), {
      statusCode: 402,
      kind: "access-denied",
      isRetryable: false,
    })
    expect(defaultRequestRetryPolicy.decide(error, context)).toEqual({
      action: "fail",
      failQueue: true,
    })
  })

  it("drains even without an explicit kind", () => {
    const error = attachRequestErrorMeta(new Error("Payment Required"), { statusCode: 402 })
    expect(defaultRequestRetryPolicy.decide(error, context)).toEqual({
      action: "fail",
      failQueue: true,
    })
  })
})
```

（`context` 用该文件既有的最小上下文对象；若该文件没有现成 `context` 变量，按既有用例内联构造 `{ retryCount: 0, maxRetries: 2, baseRetryDelayMs: 1000, now: 0, rateLimitRetryCount: 0, consecutiveRateLimits: 0 }`。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/utils/request/__tests__/retry-policy.test.ts`
Expected: 新增 2 例 FAIL（第二例：裸 402 目前走非致命路径）。

- [ ] **Step 3: 实现**

`src/utils/request/retry-policy.ts` 的 `isQueueFatalRequestErrorMeta`：

```ts
function isQueueFatalRequestErrorMeta(meta: RequestErrorMeta): boolean {
  // "access-denied" marks hosted hard denials (quota exhausted / tier
  // restricted / unauthenticated): every queued sibling would fail
  // identically, so drain like 401/403/404. Draining also fails unrelated
  // tasks sharing the queue (e.g. a queued summary) — rare, and consistent
  // with the status-code drains below.
  // 402 = 余额耗尽（规格 §6.3）：该页剩余批次全部取消，充值引导由错误文案承担。
  return (
    meta.kind === "access-denied" ||
    meta.statusCode === 401 ||
    meta.statusCode === 402 ||
    meta.statusCode === 403 ||
    meta.statusCode === 404
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run src/utils/request/__tests__/retry-policy.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/utils/request/retry-policy.ts src/utils/request/__tests__/retry-policy.test.ts
git commit -m "feat(request): treat 402 payment-required as queue-fatal"
```

---

### Task 8: background-stream 换芯（托管文本流 → billing）

**Files:**

- Modify: `src/entrypoints/background/background-stream.ts`
- Modify: `src/types/background-stream.ts`（payload 加 `billingTag`）
- Modify: `src/types/background-generate-text.ts`（payload 加 `billingTag`）
- Modify: `src/entrypoints/background/translation-queues.ts`（摘要子调用标 `summarization`）
- Test: `src/entrypoints/background/__tests__/background-stream.test.ts`（改写托管文本用例）

**Interfaces:**

- Consumes: `createBillingTextPartStream`（Task 6）、`BillingFeature`（Task 2）。
- Produces: `createHostedTextPartStream` 的内部实现换成 billing；`runStreamTextInBackground` / `generateTextForProviderRef` 对外签名与行为不变（所有调用方零改动）。

- [ ] **Step 1: 类型接线**

`src/types/background-stream.ts`：顶部 import 区加

```ts
import type { BillingFeature } from "@/utils/billing/types"
```

`BaseBackgroundStreamSerializablePayload` 追加字段（`hostedFeature` 在 `BackgroundStreamTextSerializablePayload` 里，`billingTag` 放基础接口，让非流式 payload 也能带）：

```ts
  /**
   * Billing feature label override for the hosted text route (spec §6.1:
   * summary sub-calls bill as "summarization"). Absent = the hosted route.
   */
  billingTag?: BillingFeature
```

`src/types/background-generate-text.ts` 的 `BackgroundGenerateTextPayload` 追加：

```ts
  /** Billing feature label override — summaries bill as "summarization". */
  billingTag?: string
```

- [ ] **Step 2: 换 `createHostedTextPartStream`（先改代码，既有托管文本测试将红）**

`src/entrypoints/background/background-stream.ts`：

导入（替换既有 oRPC 文本过程表所需的引用；`backgroundOrpcClient` 保留——结构化路由仍在用）：

```ts
import { createBillingTextPartStream } from "@/utils/billing/generate"
import type { BillingFeature } from "@/utils/billing/types"
```

**删除** `HOSTED_TEXT_STREAM_PROCEDURES` 常量（约 660–675 行）及其上方注释。保留 `HostedStreamFn` 类型（`createHostedStructuredObjectPartStream` / `createHostedNoteSuggestionPartStream` 仍在用）。

把 `createHostedTextPartStream` 函数体整体替换为：

```ts
async function createHostedTextPartStream(
  serializablePayload: BackgroundStreamTextSerializablePayload,
  signal?: AbortSignal,
): Promise<AsyncIterable<unknown>> {
  const { prompt, instructions, temperature, modelTier, requestId, hostedFeature, billingTag } =
    serializablePayload

  // The contract schema keeps validating shape client-side; billing ignores
  // temperature/modelTier (single model) but the payload stays compatible.
  const input = HostedAiStreamTextInputSchema.safeParse({
    instructions,
    prompt,
    temperature,
    modelTier,
    requestId,
  })
  if (!input.success) {
    throw new BackgroundStreamError("invalid_request", "Invalid hosted AI request")
  }
  if (!input.data.requestId) {
    throw new BackgroundStreamError("invalid_request", "Hosted AI request requires requestId")
  }

  // 规格 §6.1：路由即功能标签；摘要子调用覆盖为 "summarization"。
  const feature: BillingFeature = billingTag ?? hostedFeature ?? "pageTranslation"

  try {
    return await createBillingTextPartStream(
      {
        systemPrompt: input.data.instructions,
        prompt: input.data.prompt,
        requestId: input.data.requestId,
        feature,
      },
      signal,
    )
  } catch (error) {
    throw normalizeHostedAiError(error)
  }
}
```

（`normalizeHostedAiError` 对已带 meta 的 billing 错误原样透传——其 switch 只匹配 oRPC code，default 返回原错误。保留包装以复用未来新错误码的集中处理点。）

`generateTextForProviderRef` 的 system 分支 payload 透传 `billingTag`：

```ts
const partStream = await createHostedTextPartStream(
  {
    providerId: providerRef.providerId,
    modelTier: providerRef.modelTier,
    requestId,
    hostedFeature,
    billingTag,
    instructions,
    prompt,
  },
  signal,
)
```

并在函数开头的解构中加上 `billingTag`：

```ts
const { providerRef, hostedFeature, billingTag, instructions, prompt, requestId, maxRetries } =
  payload
```

- [ ] **Step 3: 摘要标 `summarization`**

`src/entrypoints/background/translation-queues.ts` 的 `getOrGenerateSummary` 内 generate 回调：

```ts
        generateTextForProviderRef(
          { ...payload, requestId: hostedRequestId, billingTag: "summarization" },
          runOptions,
        ),
```

- [ ] **Step 4: 改写托管文本测试**

`src/entrypoints/background/__tests__/background-stream.test.ts`：既有对 `@/utils/orpc/background-client` 的 mock 中，**文本流**用例改为 mock `@/utils/billing/generate`：

```ts
const createBillingTextPartStreamMock = vi.fn<(...args: any[]) => any>()
vi.mock("@/utils/billing/generate", () => ({
  createBillingTextPartStream: createBillingTextPartStreamMock,
}))
```

新增/改写两例（其余本地 BYOK / ai-sdk 用例保持不变）：

```ts
it("streams hosted text through the billing adapter", async () => {
  createBillingTextPartStreamMock.mockResolvedValue(
    (async function* () {
      yield { type: "text-delta", text: "你好" }
      yield { type: "text-delta", text: "，世界" }
      yield { type: "finish", finishReason: "stop" }
    })(),
  )

  const result = await runStreamTextInBackground(
    {
      providerId: "read-frog-free-ai",
      modelTier: "normal",
      requestId: "rid-1",
      hostedFeature: "pageTranslation",
      instructions: "sys",
      prompt: "hello",
    },
    {},
  )

  expect(result.output).toBe("你好，世界")
  expect(createBillingTextPartStreamMock).toHaveBeenCalledWith(
    {
      systemPrompt: "sys",
      prompt: "hello",
      requestId: "rid-1",
      feature: "pageTranslation",
    },
    undefined,
  )
})

it("surfaces billing 402 as a queue-fatal error", async () => {
  const billing402 = new Error("余额不足，请充值")
  Object.assign(billing402, { statusCode: 402, kind: "access-denied", isRetryable: false })
  createBillingTextPartStreamMock.mockRejectedValue(billing402)

  await expect(
    runStreamTextInBackground(
      {
        providerId: "read-frog-free-ai",
        modelTier: "normal",
        requestId: "rid-2",
        hostedFeature: "pageTranslation",
        instructions: "sys",
        prompt: "hello",
      },
      {},
    ),
  ).rejects.toMatchObject({ statusCode: 402, kind: "access-denied" })
})
```

（`runStreamTextInBackground` 的第二个参数签名以现文件为准；既有测试若已有托管用例调用 `createHostedTextPartStream` 的间接路径，一律改由这个 mock 驱动。结构化对象/笔记建议用例继续用 oRPC mock，不动。）

- [ ] **Step 5: 运行确认通过**

Run: `pnpm vitest run src/entrypoints/background/__tests__/background-stream.test.ts`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/background/background-stream.ts src/types/background-stream.ts src/types/background-generate-text.ts src/entrypoints/background/translation-queues.ts src/entrypoints/background/__tests__/background-stream.test.ts
git commit -m "feat(billing): swap hosted text transport to billing /v1/generate SSE"
```

---

### Task 9: 托管可用性闸门换芯（billing 会话判定）

**Files:**

- Modify: `src/entrypoints/background/hosted-ai-status.ts`（整体重写）
- Modify: `src/utils/message.ts`（`getHostedAiStatus` 返回类型）
- Modify: `src/utils/providers/provider-ref.ts`（闸门逻辑）
- Test: `src/entrypoints/background/__tests__/hosted-ai-status.test.ts`（重写）
- Test: `src/utils/providers/__tests__/provider-ref.test.ts`（更新闸门用例）

**Interfaces:**

- Consumes: `BillingHostedStatus`/`BILLING_MODEL_REVISION`（Task 2）、`getBillingSession`/`onBillingSessionChanged`（Task 2）、`billingMe`/`BillingApiError`（Task 4）。
- Produces: `getHostedAiStatus` 消息返回 `BillingHostedStatus | null`；`serializeProviderRef` 未登录即抛 `HostedAiProviderUnavailableError`。

- [ ] **Step 1: 写失败测试（整体替换 `hosted-ai-status.test.ts`）**

```ts
// src/entrypoints/background/__tests__/hosted-ai-status.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const getItemMock = vi.fn<(...args: any[]) => any>()
const setItemMock = vi.fn<(...args: any[]) => any>()
const removeItemMock = vi.fn<(...args: any[]) => any>()
const watchMock = vi.fn<(...args: any[]) => any>().mockReturnValue(() => {})
vi.mock("#imports", () => ({
  storage: {
    getItem: getItemMock,
    setItem: setItemMock,
    removeItem: removeItemMock,
    watch: watchMock,
  },
}))
vi.mock("wxt/utils/storage", () => ({
  storage: {
    getItem: getItemMock,
    setItem: setItemMock,
    removeItem: removeItemMock,
    watch: watchMock,
  },
}))

vi.mock("@/utils/message", () => ({ onMessage: vi.fn() }))

vi.mock("@/utils/billing/session", () => ({
  getBillingSession: vi.fn(),
  onBillingSessionChanged: vi.fn().mockReturnValue(() => {}),
}))
vi.mock("@/utils/billing/rest", () => ({
  billingMe: vi.fn(),
  BillingApiError: class BillingApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
      this.name = "BillingApiError"
    }
  },
}))

import { onMessage } from "@/utils/message"
import { BillingApiError, billingMe } from "@/utils/billing/rest"
import { getBillingSession } from "@/utils/billing/session"
import { clearHostedAiStatusCache, setupHostedAiStatusHandler } from "../hosted-ai-status"

type StatusHandler = () => Promise<unknown>
function lastRegisteredHandler(): StatusHandler {
  const calls = vi.mocked(onMessage).mock.calls
  const statusCall = calls.find((call) => call[0] === "getHostedAiStatus")
  return statusCall?.[1] as StatusHandler
}

const SESSION = { sessionId: "sess-1", email: "a@b.c", displayName: null, signedInAt: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  getItemMock.mockResolvedValue(null)
  watchMock.mockReturnValue(() => {})
  setupHostedAiStatusHandler()
})

describe("getHostedAiStatus handler (billing source)", () => {
  it("reports unauthenticated without a session and skips /me", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    expect(await lastRegisteredHandler()()).toEqual({
      authenticated: false,
      balanceYuan: null,
      email: null,
    })
    expect(billingMe).not.toHaveBeenCalled()
  })

  it("reports authenticated with balance from /me and caches it", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(SESSION)
    vi.mocked(billingMe).mockResolvedValue({
      user_id: "u1",
      email: "a@b.c",
      display_name: null,
      email_verified: true,
      balance: "1.2345",
      total_recharged: "2.0000",
      total_spent: "0.7655",
      total_tokens: 10,
      recent_calls: [],
    })
    const handler = lastRegisteredHandler()
    expect(await handler()).toEqual({ authenticated: true, balanceYuan: "1.2345", email: "a@b.c" })
    // 第二次命中缓存，不再打 /me
    await handler()
    expect(billingMe).toHaveBeenCalledTimes(1)
  })

  it("fails open (null) on a network error", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(SESSION)
    vi.mocked(billingMe).mockRejectedValue(new Error("network"))
    expect(await lastRegisteredHandler()()).toBeNull()
  })

  it("maps a 401 from /me back to unauthenticated", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(SESSION)
    vi.mocked(billingMe).mockRejectedValue(new BillingApiError(401, "expired"))
    expect(await lastRegisteredHandler()()).toEqual({
      authenticated: false,
      balanceYuan: null,
      email: null,
    })
  })

  it("clears the cache on session change", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(SESSION)
    vi.mocked(billingMe).mockResolvedValue({
      user_id: "u1",
      email: "a@b.c",
      display_name: null,
      email_verified: true,
      balance: "1.0000",
      total_recharged: "1.0000",
      total_spent: "0.0000",
      total_tokens: 0,
      recent_calls: [],
    })
    await lastRegisteredHandler()()
    await clearHostedAiStatusCache()
    await lastRegisteredHandler()()
    expect(billingMe).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/entrypoints/background/__tests__/hosted-ai-status.test.ts`
Expected: FAIL（旧实现调 oRPC）。

- [ ] **Step 3: 重写 hosted-ai-status.ts**

```ts
// src/entrypoints/background/hosted-ai-status.ts
import type { BillingHostedStatus } from "@/utils/billing/types"
import { storage } from "#imports"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { BillingApiError, billingMe } from "@/utils/billing/rest"
import { getBillingSession, onBillingSessionChanged } from "@/utils/billing/session"

/**
 * 30s TTL 与原实现同理：折叠字幕播放的串行逐批 resolve，又让余额/登录态
 * 变化在数秒内浮出。陈旧判定不花钱——真实闸门在 /v1/generate 自己手里
 * （402/401），这里只决定"要不要发起"。
 */
const HOSTED_AI_STATUS_TTL_MS = 30_000

/**
 * Session storage：MV3 service worker 随时被回收，内存缓存活不过两批之间。
 */
const CACHE_KEY = "session:hostedAiStatus" as const

interface CachedStatus {
  status: BillingHostedStatus
  cachedAt: number
}

let inflight: Promise<BillingHostedStatus | null> | null = null

/**
 * 登录/退出即刻作废旧判定（会话存储变更 → 后台监听触发）。
 */
export async function clearHostedAiStatusCache(): Promise<void> {
  try {
    await storage.removeItem(CACHE_KEY)
  } catch (error) {
    logger.warn("[HostedAiStatus] Failed to clear cache:", error)
  }
}

async function readCachedStatus(): Promise<BillingHostedStatus | null> {
  try {
    const cached = await storage.getItem<CachedStatus>(CACHE_KEY)
    if (!cached || Date.now() - cached.cachedAt > HOSTED_AI_STATUS_TTL_MS) {
      return null
    }
    return cached.status
  } catch (error) {
    logger.warn("[HostedAiStatus] Failed to read cache:", error)
    return null
  }
}

const UNAUTHENTICATED: BillingHostedStatus = {
  authenticated: false,
  balanceYuan: null,
  email: null,
}

function fetchAndCache(): Promise<BillingHostedStatus | null> {
  inflight ??= (async (): Promise<BillingHostedStatus | null> => {
    const session = await getBillingSession()
    if (!session) {
      return UNAUTHENTICATED
    }
    try {
      const me = await billingMe(session.sessionId)
      return { authenticated: true, balanceYuan: me.balance, email: me.email }
    } catch (error) {
      if (error instanceof BillingApiError && error.status === 401) {
        // 会话服务端已失效（rest 层已清本地）：未登录判定
        return UNAUTHENTICATED
      }
      // Fail open：调用方把 null 当"无判定"，/v1/generate 自己把关。
      logger.warn("[HostedAiStatus] Billing status fetch failed:", error)
      return null
    }
  })()
    .then(async (status) => {
      if (status !== null) {
        try {
          await storage.setItem<CachedStatus>(CACHE_KEY, { status, cachedAt: Date.now() })
        } catch (error) {
          logger.warn("[HostedAiStatus] Failed to write cache:", error)
        }
      }
      return status
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}

export function setupHostedAiStatusHandler(): void {
  onBillingSessionChanged(() => {
    void clearHostedAiStatusCache()
  })
  onMessage("getHostedAiStatus", async () => {
    return (await readCachedStatus()) ?? (await fetchAndCache())
  })
}
```

- [ ] **Step 4: 消息协议与闸门**

`src/utils/message.ts`：`HostedAiStatus` 的 import 改为 billing 类型，协议行改为：

```ts
import type { BillingHostedStatus } from "@/utils/billing/types"
...
  getHostedAiStatus: () => Promise<BillingHostedStatus | null>
```

（原 `import type { HostedAiStatus } from "@/utils/hosted-ai/types"` 若此文件无其它引用则删除。）

`src/utils/providers/provider-ref.ts`：

```ts
import { BILLING_MODEL_REVISION } from "@/utils/billing/types"
```

删除 `getHostedAiCreditForFeature` / `getHostedAiTierDescription` / `getHostedAiTierStatus` 的 import。`fetchHostedAiStatus` 的返回类型改 `Promise<BillingHostedStatus | undefined>`（函数体不变）。`serializeProviderRef` 的闸门段替换为：

```ts
const status = await fetchHostedAiStatus()

// billing 闸门 = 登录态。余额不在这里查：后端 402 兜底并把"充值引导"
// 交给错误分级（规格 §6.3），闸门保持轻量。
if (status && !status.authenticated) {
  throw new HostedAiProviderUnavailableError(
    provider,
    i18n.t("hostedAi.availability.authenticationRequired"),
  )
}

return {
  kind: "system",
  providerId: provider.id,
  modelTier: provider.modelTier,
  modelRevision: BILLING_MODEL_REVISION,
}
```

（`i18n` 若尚未在 provider-ref.ts 导入，补 `import { i18n } from "@/utils/i18n"`。）

- [ ] **Step 5: 更新 provider-ref 测试**

`src/utils/providers/__tests__/provider-ref.test.ts`（及其关联的 `provider-availability.test.ts`）：把原 `getHostedAiStatus` mock 形状从 readfrog `HostedAiStatus` 改为 `BillingHostedStatus`，用例语义改为：

```ts
it("throws unavailable when signed out", async () => {
  sendMessageMock.mockResolvedValue({ authenticated: false, balanceYuan: null, email: null })
  await expect(serializeProviderRef(systemProvider, "pageTranslation")).rejects.toBeInstanceOf(
    HostedAiProviderUnavailableError,
  )
})

it("serializes with the billing model revision when signed in", async () => {
  sendMessageMock.mockResolvedValue({ authenticated: true, balanceYuan: "1.0000", email: "a@b.c" })
  await expect(serializeProviderRef(systemProvider, "pageTranslation")).resolves.toEqual({
    kind: "system",
    providerId: systemProvider.id,
    modelTier: systemProvider.modelTier,
    modelRevision: "billing-v1",
  })
})

it("fails open when the status ask errors or times out", async () => {
  sendMessageMock.mockResolvedValue(null)
  await expect(serializeProviderRef(systemProvider, "pageTranslation")).resolves.toMatchObject({
    kind: "system",
    modelRevision: "billing-v1",
  })
})
```

（`systemProvider` / `sendMessageMock` 用该文件既有夹具；若既有用例断言 readfrog tier/revision 语义，按上述三例语义改写。）

- [ ] **Step 6: 运行确认通过**

Run: `pnpm vitest run src/entrypoints/background/__tests__/hosted-ai-status.test.ts src/utils/providers/__tests__/provider-ref.test.ts src/utils/providers/__tests__/provider-availability.test.ts`
Expected: 全 PASS。

- [ ] **Step 7: Commit**

```bash
git add src/entrypoints/background/hosted-ai-status.ts src/utils/message.ts src/utils/providers/provider-ref.ts src/entrypoints/background/__tests__/hosted-ai-status.test.ts src/utils/providers/__tests__/provider-ref.test.ts src/utils/providers/__tests__/provider-availability.test.ts
git commit -m "feat(billing): gate hosted availability on billing session"
```

---

### Task 10: 翻译队列拆分（计费通道限速 1）

**Files:**

- Modify: `src/utils/constants/translate.ts`
- Modify: `src/entrypoints/background/translation-queues.ts`
- Test: `src/entrypoints/background/__tests__/translation-queues.test.ts`（追加）

**Interfaces:**

- Consumes: 无。
- Produces: 每通道两个 `RequestQueue`——`localRequestQueue`（用户配置速率）与 `hostedRequestQueue`（`rate=1, capacity=1`，规格 §6.4）；批次大小/重试/超时参数不变。

- [ ] **Step 1: 写失败测试**

`src/entrypoints/background/__tests__/translation-queues.test.ts` 追加（`createTranslationQueues` 在 Step 3 加 `export` 后可直接单测；计时沿用仓库既有的 `vi.useFakeTimers` + `advanceTimersByTimeAsync` 风格）：

```ts
import { createTranslationQueues } from "../translation-queues"

describe("billing rate enforcement (createTranslationQueues)", () => {
  const setup = {
    requestQueueConfig: { rate: 8, capacity: 20 },
    batchQueueConfig: { maxCharactersPerBatch: 1000, maxItemsPerBatch: 4 },
    promptResolver: (async () => ({ systemPrompt: "s", prompt: "p" })) as never,
    queueName: "webpage" as const,
    hostedFeature: "pageTranslation" as const,
    configSource: "user" as const,
  }

  it("dispatches hosted batches at rate 1 regardless of user config", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const queues = await createTranslationQueues(setup)
      const order: string[] = []
      const thunk = async () => {
        order.push("hosted")
      }
      const p1 = queues.hostedRequestQueue.enqueue(thunk, 0, "h1")
      const p2 = queues.hostedRequestQueue.enqueue(thunk, 0, "h2")

      await vi.advanceTimersByTimeAsync(50)
      expect(order).toEqual(["hosted"]) // 第二发被限速，未放行

      await vi.advanceTimersByTimeAsync(1_000)
      await Promise.all([p1, p2])
      expect(order).toEqual(["hosted", "hosted"]) // 1 秒后放行第二发
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps the local queue on the user-configured rate", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const queues = await createTranslationQueues(setup)
      const order: string[] = []
      const thunk = async () => {
        order.push("local")
      }
      const p1 = queues.localRequestQueue.enqueue(thunk, 0, "l1")
      const p2 = queues.localRequestQueue.enqueue(thunk, 0, "l2")

      await vi.advanceTimersByTimeAsync(200) // rate 8 → 间隔 ~125ms，两发都应放行
      await Promise.all([p1, p2])
      expect(order).toEqual(["local", "local"])
    } finally {
      vi.useRealTimers()
    }
  })
})
```

（若该文件顶部的 import/mock 与 `createTranslationQueues` 的模块依赖冲突——它 import 了 db/config 等——按该文件既有的模块 mock 方式补齐；断言语义不变。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/entrypoints/background/__tests__/translation-queues.test.ts`
Expected: 新增用例 FAIL。

- [ ] **Step 3: 实现**

`src/utils/constants/translate.ts` 追加：

```ts
/**
 * 计费通道对齐后端在途=1（规格 §6.4）：每秒一批、不突发。
 * 用户配置的速率只作用于本地/BYOK 队列。
 */
export const HOSTED_REQUEST_RATE = 1
export const HOSTED_REQUEST_CAPACITY = 1
```

`src/entrypoints/background/translation-queues.ts`：

先把 `async function createTranslationQueues<TContext>` 改为 `export async function createTranslationQueues<TContext>`（Step 1 的单测直接 import 它）。

import 追加 `HOSTED_REQUEST_CAPACITY, HOSTED_REQUEST_RATE`。

`createTranslationQueues`：

```ts
  const localRequestQueue = new RequestQueue({
    rate,
    capacity,
    timeoutMs: 20_000,
    maxRetries: 2,
    baseRetryDelayMs: 1_000,
  })
  const hostedRequestQueue = new RequestQueue({
    rate: HOSTED_REQUEST_RATE,
    capacity: HOSTED_REQUEST_CAPACITY,
    timeoutMs: 20_000,
    maxRetries: 2,
    baseRetryDelayMs: 1_000,
  })
  const batchQueue = new BatchQueue<TranslateBatchData<TContext>, string>({
    ...
    dispatchGate: {
      nextDispatchEtaMs: () =>
        Math.max(localRequestQueue.nextDispatchEtaMs(), hostedRequestQueue.nextDispatchEtaMs()),
    },
    ...
    executeBatch: async (dataList, meta) => {
      ...
      const targetQueue = hostedRequestId ? hostedRequestQueue : localRequestQueue
      return targetQueue.enqueue(batchThunk, earliestScheduleAt, hash, meta.scopes, { timeoutMs })
    },
    executeIndividual: async (data) => {
      ...
      const targetQueue = getLocalProviderConfig(provider) ? localRequestQueue : hostedRequestQueue
      return targetQueue.enqueue(thunk, scheduleAt, hash, scope ? [scope] : undefined)
    },
    ...
  })

  return { localRequestQueue, hostedRequestQueue, batchQueue }
```

`watchQueueConfig` 的形参类型与回调：`queuesPromise: Promise<{ localRequestQueue: RequestQueue; hostedRequestQueue: RequestQueue; batchQueue: {...} }>`；回调内只更新本地队列：

```ts
    void queuesPromise.then(({ localRequestQueue, batchQueue }) => {
      ...
        localRequestQueue.setQueueOptions(selected.requestQueueConfig)
      ...
    })
```

（hosted 队列速率固定，不随用户配置漂移。）

消息处理端全部解构改名：

- `enqueueTranslateRequest`：`const { localRequestQueue, batchQueue } = await queuesPromise`；非批次分支 `localRequestQueue.enqueue(...)`。
- `getOrGenerateWebPageSummary`：

```ts
    const { localRequestQueue, hostedRequestQueue } = await queuesPromise
    ...
      requestQueue: providerRef.kind === "system" ? hostedRequestQueue : localRequestQueue,
```

- `cancelPageTranslationRequests`：

```ts
const { localRequestQueue, hostedRequestQueue, batchQueue } = await queuesPromise
const cancelledBatch = batchQueue.cancelByScope(scope)
const cancelledRequests =
  localRequestQueue.cancelByScope(scope) + hostedRequestQueue.cancelByScope(scope)
```

- `browser.tabs.onRemoved` 清扫：

```ts
void queuesPromise.then(({ localRequestQueue, hostedRequestQueue, batchQueue }) => {
  batchQueue.cancelWhere((scope) => scope.startsWith(prefix))
  localRequestQueue.cancelWhere((scope) => scope.startsWith(prefix))
  hostedRequestQueue.cancelWhere((scope) => scope.startsWith(prefix))
})
```

- 字幕：`enqueueSubtitlesTranslateRequest` 非批次分支用 `localRequestQueue`；`getSubtitlesSummary` 同 `getOrGenerateWebPageSummary` 的选队列逻辑。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run src/entrypoints/background/__tests__/translation-queues.test.ts`
Expected: 全 PASS（含新增钉与既有用例）。

- [ ] **Step 5: Commit**

```bash
git add src/utils/constants/translate.ts src/entrypoints/background/translation-queues.ts src/entrypoints/background/__tests__/translation-queues.test.ts
git commit -m "feat(billing): enforce rate-1 hosted queue separate from BYOK queues"
```

---

### Task 11: 选项页 Account 页（登录/注册/验证码/找回/余额）

**Files:**

- Create: `src/entrypoints/options/pages/account/index.tsx`
- Modify: `src/entrypoints/options/app-sidebar/nav-items.ts`
- Modify: `src/entrypoints/options/app.tsx`
- Modify: `src/entrypoints/options/app-sidebar/settings-nav.tsx`
- Modify: `src/entrypoints/options/command-palette/search-items.ts`
- Test: `src/entrypoints/options/pages/account/__tests__/account.test.tsx`

**Interfaces:**

- Consumes: billing rest/session（Task 2/4）、i18n 键（Task 5）、`PageLayout`/`ConfigSection`（既有）。
- Produces: `AccountPage` 导出；`/account` 路由。

- [ ] **Step 1: 写失败测试**

```tsx
// src/entrypoints/options/pages/account/__tests__/account.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("@/env", () => ({ env: { WXT_BILLING_API_URL: "https://billing.test" } }))

vi.mock("@/utils/billing/session", () => ({
  getBillingSession: vi.fn(),
  setBillingSession: vi.fn(),
  clearBillingSession: vi.fn().mockResolvedValue(undefined),
  onBillingSessionChanged: vi.fn().mockReturnValue(() => {}),
}))
vi.mock("@/utils/billing/rest", () => ({
  billingLogin: vi.fn(),
  billingRegister: vi.fn(),
  billingVerifyCode: vi.fn(),
  billingResendVerify: vi.fn(),
  billingForgotPassword: vi.fn(),
  billingResetPassword: vi.fn(),
  billingLogout: vi.fn(),
  billingMe: vi.fn(),
}))

import { billingLogin, billingMe, billingRegister, billingVerifyCode } from "@/utils/billing/rest"
import { getBillingSession, setBillingSession } from "@/utils/billing/session"
import { AccountPage } from "../index"

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("AccountPage", () => {
  it("shows login and register entries when signed out", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    renderPage()
    await waitFor(() => {
      expect(screen.getByText("billing.login.title")).toBeTruthy()
    })
    expect(screen.getByText("billing.register.switchToLogin")).toBeTruthy()
  })

  it("logs in and stores the session", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    vi.mocked(billingLogin).mockResolvedValue({
      session_id: "sess-9",
      user_id: "u1",
      expires_in_days: 30,
    })
    renderPage()
    await waitFor(() => screen.getByLabelText("billing.login.email"))
    fireEvent.change(screen.getByLabelText("billing.login.email"), { target: { value: "a@b.c" } })
    fireEvent.change(screen.getByLabelText("billing.login.password"), {
      target: { value: "password1" },
    })
    fireEvent.click(screen.getByText("billing.login.submit"))
    await waitFor(() => {
      expect(setBillingSession).toHaveBeenCalledWith({
        sessionId: "sess-9",
        email: "a@b.c",
        displayName: null,
      })
    })
  })

  it("register → verify → auto-login flow", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    vi.mocked(billingRegister).mockResolvedValue({ message: "ok", user_id: "u1", mail_sent: true })
    vi.mocked(billingVerifyCode).mockResolvedValue({ message: "ok" })
    vi.mocked(billingLogin).mockResolvedValue({
      session_id: "sess-9",
      user_id: "u1",
      expires_in_days: 30,
    })
    renderPage()
    await waitFor(() => screen.getByText("billing.login.switchToRegister"))
    fireEvent.click(screen.getByText("billing.login.switchToRegister"))
    fireEvent.change(screen.getByLabelText("billing.register.displayName"), {
      target: { value: "喵" },
    })
    fireEvent.change(screen.getByLabelText("billing.register.email"), {
      target: { value: "a@b.c" },
    })
    fireEvent.change(screen.getByLabelText("billing.register.password"), {
      target: { value: "password1" },
    })
    fireEvent.click(screen.getByText("billing.register.submit"))
    await waitFor(() => screen.getByLabelText("billing.register.code"))
    fireEvent.change(screen.getByLabelText("billing.register.code"), {
      target: { value: "123456" },
    })
    fireEvent.click(screen.getByText("billing.register.verify"))
    await waitFor(() => {
      expect(billingVerifyCode).toHaveBeenCalledWith({ email: "a@b.c", code: "123456" })
      expect(billingLogin).toHaveBeenCalledWith({ email: "a@b.c", password: "password1" })
      expect(setBillingSession).toHaveBeenCalledWith({
        sessionId: "sess-9",
        email: "a@b.c",
        displayName: "喵",
      })
    })
  })

  it("shows balance and logout when signed in", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "sess-1",
      email: "a@b.c",
      displayName: "喵",
      signedInAt: 1,
    })
    vi.mocked(billingMe).mockResolvedValue({
      user_id: "u1",
      email: "a@b.c",
      display_name: "喵",
      email_verified: true,
      balance: "3.1400",
      total_recharged: "5.0000",
      total_spent: "1.8600",
      total_tokens: 123,
      recent_calls: [],
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText("3.1400")).toBeTruthy()
    })
    expect(screen.getByText("a@b.c")).toBeTruthy()
  })
})
```

（`vi.mocked(onBillingSessionChangedStub)` 一行删去，若粘贴残留——它只是提醒：`onBillingSessionChanged` 已在模块级 mock。i18n 在测试里返回键名本身（vitest.setup.ts 已配），故断言用键名。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/entrypoints/options/pages/account/__tests__/account.test.tsx`
Expected: FAIL（页面不存在）。

- [ ] **Step 3: 实现页面**

```tsx
// src/entrypoints/options/pages/account/index.tsx
import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import { Label } from "@/components/ui/base-ui/label"
import type { BillingSession } from "@/utils/billing/types"
import {
  billingForgotPassword,
  billingLogin,
  billingLogout,
  billingMe,
  billingRegister,
  billingResendVerify,
  billingResetPassword,
  billingVerifyCode,
} from "@/utils/billing/rest"
import {
  clearBillingSession,
  getBillingSession,
  onBillingSessionChanged,
  setBillingSession,
} from "@/utils/billing/session"
import { i18n } from "@/utils/i18n"
import { logger } from "@/utils/logger"
import { ConfigSection } from "../../components/config-section"
import { PageLayout } from "../../components/page-layout"

type AuthView = "login" | "register" | "verify" | "reset-request" | "reset-confirm"

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="text-sm text-destructive">{message}</p>
}

function LoginForm({
  onSession,
  onSwitchView,
}: {
  onSession: (session: BillingSession) => void
  onSwitchView: (view: AuthView) => void
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const login = useMutation({
    mutationFn: async () => {
      const result = await billingLogin({ email, password })
      return setBillingSession({ sessionId: result.session_id, email, displayName: null })
    },
    onSuccess: onSession,
    onError: (err: Error) => setError(err.message),
  })

  return (
    <form
      className="grid max-w-sm gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        login.mutate()
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="billing-login-email">{i18n.t("billing.login.email")}</Label>
        <Input
          id="billing-login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-login-password">{i18n.t("billing.login.password")}</Label>
        <Input
          id="billing-login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      <ErrorText message={error} />
      <Button type="submit" disabled={login.isPending}>
        {i18n.t("billing.login.submit")}
      </Button>
      <div className="flex justify-between text-sm">
        <button
          type="button"
          className="cursor-pointer text-primary"
          onClick={() => onSwitchView("reset-request")}
        >
          {i18n.t("billing.login.forgotPassword")}
        </button>
        <button
          type="button"
          className="cursor-pointer text-primary"
          onClick={() => onSwitchView("register")}
        >
          {i18n.t("billing.login.switchToRegister")}
        </button>
      </div>
    </form>
  )
}

function RegisterForm({
  onRegistered,
  onSwitchView,
}: {
  onRegistered: (pending: { displayName: string; email: string; password: string }) => void
  onSwitchView: (view: AuthView) => void
}) {
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const register = useMutation({
    mutationFn: () => billingRegister({ email, password, displayName }),
    onSuccess: () => onRegistered({ displayName, email, password }),
    onError: (err: Error) => setError(err.message),
  })

  return (
    <form
      className="grid max-w-sm gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        register.mutate()
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="billing-register-name">{i18n.t("billing.register.displayName")}</Label>
        <Input
          id="billing-register-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-register-email">{i18n.t("billing.register.email")}</Label>
        <Input
          id="billing-register-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-register-password">{i18n.t("billing.register.password")}</Label>
        <Input
          id="billing-register-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      <ErrorText message={error} />
      <Button type="submit" disabled={register.isPending}>
        {i18n.t("billing.register.submit")}
      </Button>
      <button
        type="button"
        className="cursor-pointer text-left text-sm text-primary"
        onClick={() => onSwitchView("login")}
      >
        {i18n.t("billing.register.switchToLogin")}
      </button>
    </form>
  )
}

function VerifyCodeForm({
  pending,
  onSession,
}: {
  pending: { displayName: string; email: string; password: string }
  onSession: (session: BillingSession) => void
}) {
  const [code, setCode] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 激活成功后立即用同邮箱+密码登录（/verify-code 只激活不发会话）
  const verify = useMutation({
    mutationFn: async () => {
      await billingVerifyCode({ email: pending.email, code })
      const result = await billingLogin({ email: pending.email, password: pending.password })
      return setBillingSession({
        sessionId: result.session_id,
        email: pending.email,
        displayName: pending.displayName || null,
      })
    },
    onSuccess: onSession,
    onError: (err: Error) => setError(err.message),
  })

  const resend = useMutation({
    mutationFn: () => billingResendVerify(pending.email),
    onSuccess: () => {
      setNotice(i18n.t("billing.register.resendSuccess"))
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <form
      className="grid max-w-sm gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        setNotice(null)
        verify.mutate()
      }}
    >
      <h3 className="text-sm font-medium">{i18n.t("billing.register.codeTitle")}</h3>
      <p className="text-sm text-muted-foreground">
        {i18n.t("billing.register.codeDescription", [pending.email])}
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-verify-code">{i18n.t("billing.register.code")}</Label>
        <Input
          id="billing-verify-code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          required
        />
      </div>
      <ErrorText message={error} />
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <Button type="submit" disabled={verify.isPending || code.length !== 6}>
        {i18n.t("billing.register.verify")}
      </Button>
      <button
        type="button"
        className="cursor-pointer text-left text-sm text-primary"
        disabled={resend.isPending}
        onClick={() => resend.mutate()}
      >
        {i18n.t("billing.register.resend")}
      </button>
    </form>
  )
}

function ResetPasswordForms({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<"request" | "confirm">("request")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sendCode = useMutation({
    mutationFn: () => billingForgotPassword(email),
    onSuccess: () => {
      setStage("confirm")
      setNotice(i18n.t("billing.reset.codeSent", [email]))
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const reset = useMutation({
    mutationFn: () => billingResetPassword({ email, code, newPassword }),
    onSuccess: onDone,
    onError: (err: Error) => setError(err.message),
  })

  if (stage === "request") {
    return (
      <form
        className="grid max-w-sm gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setError(null)
          sendCode.mutate()
        }}
      >
        <p className="text-sm text-muted-foreground">
          {i18n.t("billing.reset.requestDescription")}
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="billing-reset-email">{i18n.t("billing.login.email")}</Label>
          <Input
            id="billing-reset-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <ErrorText message={error} />
        <Button type="submit" disabled={sendCode.isPending}>
          {i18n.t("billing.reset.sendCode")}
        </Button>
      </form>
    )
  }

  return (
    <form
      className="grid max-w-sm gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        reset.mutate()
      }}
    >
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="billing-reset-code">{i18n.t("billing.reset.code")}</Label>
        <Input
          id="billing-reset-code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="billing-reset-password">{i18n.t("billing.reset.newPassword")}</Label>
        <Input
          id="billing-reset-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />
      </div>
      <ErrorText message={error} />
      <Button type="submit" disabled={reset.isPending || code.length !== 6}>
        {i18n.t("billing.reset.submit")}
      </Button>
    </form>
  )
}

function AccountAuthForms({ onSession }: { onSession: (session: BillingSession) => void }) {
  const [view, setView] = useState<AuthView>("login")
  const [pendingRegistration, setPendingRegistration] = useState<{
    displayName: string
    email: string
    password: string
  } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <ConfigSection id="billing-account-auth" title={i18n.t("billing.account.title")}>
      <p className="text-sm text-muted-foreground">{i18n.t("billing.account.loginOrRegister")}</p>
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      {view === "login" && (
        <LoginForm
          onSession={onSession}
          onSwitchView={(next) => {
            setNotice(null)
            setView(next)
          }}
        />
      )}
      {view === "register" && (
        <RegisterForm
          onRegistered={(pending) => {
            setPendingRegistration(pending)
            setView("verify")
          }}
          onSwitchView={setView}
        />
      )}
      {view === "verify" && pendingRegistration && (
        <VerifyCodeForm pending={pendingRegistration} onSession={onSession} />
      )}
      {view === "reset-request" && (
        <ResetPasswordForms
          onDone={() => {
            setNotice(i18n.t("billing.reset.success"))
            setView("login")
          }}
        />
      )}
      {view !== "login" && view !== "verify" && (
        <button
          type="button"
          className="cursor-pointer text-left text-sm text-primary"
          onClick={() => {
            setNotice(null)
            setView("login")
          }}
        >
          {i18n.t("billing.reset.backToLogin")}
        </button>
      )}
    </ConfigSection>
  )
}

function AccountOverview({ session }: { session: BillingSession }) {
  const meQuery = useQuery({
    queryKey: ["billing", "me", session.sessionId],
    queryFn: () => billingMe(session.sessionId),
    retry: false,
    staleTime: 60_000,
  })

  const logout = useMutation({
    mutationFn: async () => {
      try {
        await billingLogout(session.sessionId)
      } catch (error) {
        logger.warn("[billing] logout request failed, clearing local session anyway:", error)
      }
      await clearBillingSession()
    },
    meta: { errorDescription: i18n.t("account.logoutError") },
  })

  return (
    <ConfigSection id="billing-account-overview" title={i18n.t("billing.account.title")}>
      <div className="grid max-w-sm gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{i18n.t("billing.login.email")}</span>
          <span>{meQuery.data?.email ?? session.email}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{i18n.t("billing.account.balance")}</span>
          <span className="font-medium">
            {meQuery.isPending ? "…" : (meQuery.data?.balance ?? "—")}
          </span>
        </div>
      </div>
      <div className="grid max-w-sm gap-3">
        <p className="text-sm text-muted-foreground">{i18n.t("billing.account.rechargeGuide")}</p>
        <Button variant="outline" disabled={logout.isPending} onClick={() => logout.mutate()}>
          {i18n.t("account.logout")}
        </Button>
      </div>
    </ConfigSection>
  )
}

export function AccountPage() {
  const [session, setSession] = useState<BillingSession | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)

  useEffect(() => {
    let active = true
    void getBillingSession().then((value) => {
      if (!active) return
      setSession(value)
      setSessionLoading(false)
    })
    const unwatch = onBillingSessionChanged((value) => {
      setSession(value)
    })
    return () => {
      active = false
      unwatch()
    }
  }, [])

  if (sessionLoading) {
    return null
  }

  return (
    <PageLayout
      title={i18n.t("options.account.title")}
      description={i18n.t("options.account.description")}
    >
      {session ? (
        <AccountOverview session={session} />
      ) : (
        <AccountAuthForms onSession={setSession} />
      )}
    </PageLayout>
  )
}
```

- [ ] **Step 4: 路由注册**

`nav-items.ts`：主路由清单加一行（`"/tts"` 之后）：`{ path: "/account" },`

`app.tsx`：

```ts
const AccountPage = lazy(() =>
  import("./pages/account").then((module) => ({ default: module.AccountPage })),
)
```

`ROUTE_COMPONENTS` 加 `"/account": AccountPage,`

`settings-nav.tsx`：`/shortcuts` 条目后加：

```tsx
<SidebarMenuItem>
  <SidebarMenuButton
    render={<Link to="/account" />}
    isActive={pathname === "/account"}
    tooltip={i18n.t("options.account.title")}
  >
    <Icon icon="tabler:user" />
    <span>{i18n.t("options.account.title")}</span>
  </SidebarMenuButton>
</SidebarMenuItem>
```

`search-items.ts`：`SEARCH_ITEMS` 加：

```ts
  {
    sectionId: "account",
    route: "/account",
    titleKey: "options.account.title",
    descriptionKey: "options.account.description",
    pageKey: "options.account.title",
  },
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm vitest run src/entrypoints/options/pages/account/__tests__/account.test.tsx`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/options/pages/account src/entrypoints/options/app-sidebar/nav-items.ts src/entrypoints/options/app.tsx src/entrypoints/options/app-sidebar/settings-nav.tsx src/entrypoints/options/command-palette/search-items.ts
git commit -m "feat(billing): options account page with register/login/reset flows"
```

---

### Task 12: 账户菜单换芯（popup + 选项页侧栏）

**Files:**

- Modify: `src/components/user-account-menu/shared.tsx`
- Modify: `src/components/user-account-menu/popup.tsx`
- Modify: `src/components/user-account-menu/sidebar.tsx`
- Test: `src/components/user-account-menu/__tests__/shared.test.ts`（若不存在则新建 `shared.test.tsx`）

**Interfaces:**

- Consumes: session（Task 2）、rest（Task 4）、i18n（Task 5）、`sendMessage("openOptionsPage", {route})`（既有消息协议）。
- Produces: `useUserAccountMenu()` 返回 `{ state, email, displayName, balanceYuan, isPending, logout, openAccountSettings }`——popup/sidebar 消费。删除 better-auth 与 `orpc.billing` 依赖。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/user-account-menu/__tests__/shared.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("@/env", () => ({ env: { WXT_BILLING_API_URL: "https://billing.test" } }))
vi.mock("@/utils/message", () => ({ sendMessage: vi.fn() }))
vi.mock("@/utils/billing/session", () => ({
  getBillingSession: vi.fn(),
  clearBillingSession: vi.fn().mockResolvedValue(undefined),
  onBillingSessionChanged: vi.fn().mockReturnValue(() => {}),
}))
vi.mock("@/utils/billing/rest", () => ({
  billingMe: vi.fn(),
  billingLogout: vi.fn().mockResolvedValue({ message: "ok" }),
}))

import { sendMessage } from "@/utils/message"
import { billingLogout, billingMe } from "@/utils/billing/rest"
import { clearBillingSession, getBillingSession } from "@/utils/billing/session"
import { ACCOUNT_STATE, useUserAccountMenu } from "../shared"

function withQueryClient({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("useUserAccountMenu (billing)", () => {
  it("reports guest when no session is stored", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    const { result } = renderHook(() => useUserAccountMenu(), { wrapper: withQueryClient })
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.state).toBe(ACCOUNT_STATE.GUEST)
  })

  it("reports authed with balance from /me", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "s1",
      email: "a@b.c",
      displayName: "喵",
      signedInAt: 1,
    })
    vi.mocked(billingMe).mockResolvedValue({
      user_id: "u1",
      email: "a@b.c",
      display_name: "喵",
      email_verified: true,
      balance: "2.5000",
      total_recharged: "3.0000",
      total_spent: "0.5000",
      total_tokens: 1,
      recent_calls: [],
    })
    const { result } = renderHook(() => useUserAccountMenu(), { wrapper: withQueryClient })
    await waitFor(() => expect(result.current.state).toBe(ACCOUNT_STATE.AUTHED))
    expect(result.current.email).toBe("a@b.c")
    await waitFor(() => expect(result.current.balanceYuan).toBe("2.5000"))
  })

  it("logout revokes server session and clears local storage", async () => {
    vi.mocked(getBillingSession).mockResolvedValue({
      sessionId: "s1",
      email: "a@b.c",
      displayName: null,
      signedInAt: 1,
    })
    vi.mocked(billingMe).mockResolvedValue({
      user_id: "u1",
      email: "a@b.c",
      display_name: null,
      email_verified: true,
      balance: "0.0000",
      total_recharged: "0.0000",
      total_spent: "0.0000",
      total_tokens: 0,
      recent_calls: [],
    })
    const { result } = renderHook(() => useUserAccountMenu(), { wrapper: withQueryClient })
    await waitFor(() => expect(result.current.state).toBe(ACCOUNT_STATE.AUTHED))
    await act(async () => {
      result.current.logout.mutate()
    })
    await waitFor(() => {
      expect(billingLogout).toHaveBeenCalledWith("s1")
      expect(clearBillingSession).toHaveBeenCalled()
    })
  })

  it("opens the options account page", async () => {
    vi.mocked(getBillingSession).mockResolvedValue(null)
    const { result } = renderHook(() => useUserAccountMenu(), { wrapper: withQueryClient })
    await waitFor(() => expect(result.current.isPending).toBe(false))
    act(() => result.current.openAccountSettings())
    expect(sendMessage).toHaveBeenCalledWith("openOptionsPage", { route: "/account" })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/components/user-account-menu/__tests__/shared.test.tsx`
Expected: FAIL（旧实现依赖 better-auth）。

- [ ] **Step 3: 重写 shared.tsx**

```tsx
// src/components/user-account-menu/shared.tsx
import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconLogout, IconWallet } from "@tabler/icons-react"
import guest from "@/assets/icons/avatars/guest.svg"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/base-ui/avatar"
import { DropdownMenuItem } from "@/components/ui/base-ui/dropdown-menu"
import type { BillingSession } from "@/utils/billing/types"
import { billingLogout, billingMe } from "@/utils/billing/rest"
import {
  clearBillingSession,
  getBillingSession,
  onBillingSessionChanged,
} from "@/utils/billing/session"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { cn } from "@/utils/styles/utils"

export const ACCOUNT_STATE = {
  LOADING: "loading",
  GUEST: "guest",
  AUTHED: "authed",
} as const

type AccountState = (typeof ACCOUNT_STATE)[keyof typeof ACCOUNT_STATE]
type AccountMenu = ReturnType<typeof useUserAccountMenu>

function getUserInitials(name: string | null | undefined) {
  const normalizedName = name?.trim()
  if (!normalizedName) return "U"
  const parts = normalizedName.split(/\s+/)
  const initials =
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`
      : Array.from(normalizedName).slice(0, 2).join("")
  return initials.toUpperCase()
}

export function openAccountSettings() {
  void sendMessage("openOptionsPage", { route: "/account" })
}

export function useUserAccountMenu() {
  const [session, setSession] = useState<BillingSession | null>(null)
  const [sessionPending, setSessionPending] = useState(true)

  useEffect(() => {
    let active = true
    void getBillingSession().then((value) => {
      if (!active) return
      setSession(value)
      setSessionPending(false)
    })
    const unwatch = onBillingSessionChanged((value) => setSession(value))
    return () => {
      active = false
      unwatch()
    }
  }, [])

  const meQuery = useQuery({
    queryKey: ["billing", "me", session?.sessionId ?? "guest"],
    queryFn: () => billingMe(session!.sessionId),
    enabled: session !== null,
    retry: false,
    staleTime: 60_000,
    meta: { suppressToast: true },
  })

  const logout = useMutation({
    mutationFn: async () => {
      if (!session) return
      try {
        await billingLogout(session.sessionId)
      } finally {
        // 服务端吊销失败也清本地：用户意图是退出，残留会话只会造成 401 循环
        await clearBillingSession()
      }
    },
    meta: { errorDescription: i18n.t("account.logoutError") },
  })

  const state: AccountState = sessionPending
    ? ACCOUNT_STATE.LOADING
    : !session
      ? ACCOUNT_STATE.GUEST
      : ACCOUNT_STATE.AUTHED

  const displayName = meQuery.data?.display_name ?? session?.displayName ?? session?.email

  return {
    state,
    session,
    email: session?.email,
    displayName: displayName || "Guest",
    balanceYuan: meQuery.data?.balance,
    isPending: sessionPending,
    logout,
    openAccountSettings,
    avatarSrc: session ? "" : guest,
    fallbackText: session ? getUserInitials(displayName) : "G",
  }
}

export function AccountNameWithBalance({
  account,
  className,
}: {
  account: AccountMenu
  className?: string
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span className="truncate font-medium">{account.displayName}</span>
      {account.balanceYuan !== undefined && (
        <span className="shrink-0 text-xs text-muted-foreground">¥{account.balanceYuan}</span>
      )}
    </span>
  )
}

export function AccountAvatar({
  account,
  size = "sm",
}: {
  account: AccountMenu
  size?: "default" | "sm" | "lg"
}) {
  return (
    <Avatar size={size} className={cn(account.isPending && "animate-pulse")}>
      <AvatarImage src={account.avatarSrc || ""} alt={account.displayName} />
      <AvatarFallback>{account.fallbackText}</AvatarFallback>
    </Avatar>
  )
}

export function AccountDetails({ account }: { account: AccountMenu }) {
  return (
    <div className="flex items-center gap-2 px-1.5 py-1.5">
      <AccountAvatar account={account} />
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <AccountNameWithBalance account={account} className="text-foreground" />
        {account.email && (
          <span className="truncate text-xs font-normal text-muted-foreground">
            {account.email}
          </span>
        )}
      </div>
    </div>
  )
}

export function RechargeMenuItem({ account }: { account: AccountMenu }) {
  return (
    <DropdownMenuItem
      onClick={account.openAccountSettings}
      className="cursor-pointer transition-colors"
    >
      <IconWallet aria-hidden />
      {i18n.t("billing.account.recharge")}
    </DropdownMenuItem>
  )
}

export function LogoutMenuItem({ account }: { account: AccountMenu }) {
  const { logout } = account
  return (
    <DropdownMenuItem
      variant="destructive"
      disabled={logout.isPending}
      onClick={() => logout.mutate()}
      className="cursor-pointer transition-colors"
    >
      <IconLogout aria-hidden className={cn(logout.isPending && "animate-pulse")} />
      {i18n.t("account.logout")}
    </DropdownMenuItem>
  )
}
```

- [ ] **Step 4: 更新 popup.tsx / sidebar.tsx**

`popup.tsx`：导入改为 `{ ACCOUNT_STATE, AccountAvatar, AccountDetails, AccountNameWithBalance, LogoutMenuItem, RechargeMenuItem, useUserAccountMenu }`。GUEST 分支的登录按钮：

```tsx
<Button size="xs" variant="outline" onClick={account.openAccountSettings}>
  {i18n.t("account.login")}
</Button>
```

（`openLogIn` 已删除；按钮回调直接用 `account.openAccountSettings`。）AUTHED 下拉内容：

```tsx
      <AccountDetails account={account} />
      <DropdownMenuSeparator />
      <RechargeMenuItem account={account} />
      <DropdownMenuSeparator />
      <LogoutMenuItem account={account} />
```

（`WebAppMenuItem` 已删除。）触发器里的 `AccountNameWithPlan` 换 `AccountNameWithBalance`。

`sidebar.tsx`：同样替换（`openLogIn` → `account.openAccountSettings`；`AccountNameWithPlan` → `AccountNameWithBalance`；`WebAppMenuItem` → `RechargeMenuItem`）。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm vitest run src/components/user-account-menu`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/components/user-account-menu
git commit -m "feat(billing): account menu shows billing session, balance and logout"
```

---

### Task 13: provider 侧 billing 状态适配（合成形状 + 余额展示 + 移除 Ultra 付费墙）

**Files:**

- Create: `src/utils/billing/hosted-status-adapter.ts`
- Modify: `src/components/llm-providers/use-hosted-ai-status.ts`
- Modify: `src/entrypoints/options/pages/api-providers/built-in-ai-usage/index.tsx`
- Modify: `src/components/llm-providers/provider-selector.tsx`
- Modify: `src/entrypoints/options/pages/api-providers/providers-config/provider-editor.tsx`
- Test: `src/utils/billing/__tests__/hosted-status-adapter.test.ts`

**Interfaces:**

- Consumes: session/rest（Task 2/4）、readfrog 契约类型 `HostedAiStatus`（`@read-frog/api-contract`）。
- Produces: `buildHostedAiStatusFromBilling(authenticated: boolean): HostedAiStatus`——7 个 feature × 2 tier 全量合成；`useHostedAiStatus` 对外接口不变（`{status, isSignedIn, isPending, isError}`）。

- [ ] **Step 1: 写失败测试**

```ts
// src/utils/billing/__tests__/hosted-status-adapter.test.ts
import { describe, expect, it } from "vitest"
import { buildHostedAiStatusFromBilling } from "../hosted-status-adapter"

const FEATURES = [
  "pageTranslation",
  "customAction",
  "noteSuggestion",
  "selectionTranslation",
  "videoSubtitles",
  "inputTranslation",
  "languageDetection",
] as const

describe("buildHostedAiStatusFromBilling", () => {
  it("marks every feature and tier available when authenticated", () => {
    const status = buildHostedAiStatusFromBilling(true)
    expect(status.credits).toEqual([])
    for (const feature of FEATURES) {
      for (const tier of ["normal", "advance"] as const) {
        expect(status.features[feature][tier]).toEqual({
          accessAllowed: true,
          available: true,
          unavailableReason: null,
          requiresUltra: false,
          modelRevision: "billing-v1",
        })
      }
    }
  })

  it("marks everything authentication-required when signed out", () => {
    const status = buildHostedAiStatusFromBilling(false)
    const tier = status.features.pageTranslation.normal
    expect(tier.accessAllowed).toBe(false)
    expect(tier.available).toBe(false)
    expect(tier.unavailableReason).toBe("authentication_required")
    expect(tier.requiresUltra).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/utils/billing/__tests__/hosted-status-adapter.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现适配器**

```ts
// src/utils/billing/hosted-status-adapter.ts
import type { HostedAiStatus, HostedAiTierStatus } from "@/utils/hosted-ai/types"
import { BILLING_MODEL_REVISION } from "./types"

function tierStatus(authenticated: boolean): HostedAiTierStatus {
  return authenticated
    ? {
        accessAllowed: true,
        available: true,
        unavailableReason: null,
        requiresUltra: false,
        modelRevision: BILLING_MODEL_REVISION,
      }
    : {
        accessAllowed: false,
        available: false,
        unavailableReason: "authentication_required",
        requiresUltra: false,
        modelRevision: BILLING_MODEL_REVISION,
      }
}

/**
 * billing 世界没有 readfrog 的分层配额：单模型、单余额。为让既有
 * 6 个 UI 消费者（provider 下拉装饰、语言检测页、popup 等）零改动，
 * 把登录态合成回 readfrog 的 `HostedAiStatus` 形状——未登录即
 * `authentication_required`（装饰器把内置 provider 置灰并提示登录），
 * 登录即全部可用（余额闸门在 /v1/generate 的 402）。
 */
export function buildHostedAiStatusFromBilling(authenticated: boolean): HostedAiStatus {
  const featureStatus = { normal: tierStatus(authenticated), advance: tierStatus(authenticated) }
  return {
    credits: [],
    features: {
      pageTranslation: featureStatus,
      customAction: featureStatus,
      noteSuggestion: featureStatus,
      selectionTranslation: featureStatus,
      videoSubtitles: featureStatus,
      inputTranslation: featureStatus,
      languageDetection: featureStatus,
    },
  }
}
```

（若 `features` 的类型要求每个 feature 独立对象引用而非共享，改为每处调用 `tierStatus` 生成；以类型检查通过为准。）

- [ ] **Step 4: 重写 use-hosted-ai-status.ts**

```ts
// src/components/llm-providers/use-hosted-ai-status.ts
import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { HostedAiStatus } from "@/utils/hosted-ai/types"
import type { BillingSession } from "@/utils/billing/types"
import { buildHostedAiStatusFromBilling } from "@/utils/billing/hosted-status-adapter"
import { billingMe } from "@/utils/billing/rest"
import { getBillingSession, onBillingSessionChanged } from "@/utils/billing/session"

export interface HostedAiStatusResult {
  status: HostedAiStatus | undefined
  /** billing 余额元字符串（如 "1.2345"）；未登录/未知为 undefined */
  balanceYuan: string | undefined
  /** False until the session resolves, so guest-only UI never flashes for members. */
  isSignedIn: boolean
  isPending: boolean
  isError: boolean
}

/**
 * 数据源从 readfrog hostedAi.status 换成 billing（会话 + /me）。返回形状
 * 保持 `HostedAiStatus`（合成），provider 下拉装饰等消费者零改动。
 * 与后台 `getHostedAiStatus` 缓存仍是两套：这里渲染实时数字，后台那份
 * 决定要不要发起调用。
 */
export function useHostedAiStatus(options: { enabled?: boolean } = {}): HostedAiStatusResult {
  const [session, setSession] = useState<BillingSession | null>(null)
  const [sessionPending, setSessionPending] = useState(true)

  useEffect(() => {
    let active = true
    void getBillingSession().then((value) => {
      if (!active) return
      setSession(value)
      setSessionPending(false)
    })
    const unwatch = onBillingSessionChanged((value) => setSession(value))
    return () => {
      active = false
      unwatch()
    }
  }, [])

  const meQuery = useQuery({
    queryKey: ["billing", "me", session?.sessionId ?? "guest"],
    queryFn: () => billingMe(session!.sessionId),
    enabled: (options.enabled ?? true) && session !== null,
    retry: false,
    staleTime: 60_000,
    meta: { suppressToast: true },
  })

  const isSignedIn = session !== null
  // /me 在途或失败都按"已登录、可用"呈现（fail open）：真实闸门在
  // /v1/generate，一次余额查询抖动不该把内置 provider 全部置灰。
  const status = useMemo(
    () => (sessionPending ? undefined : buildHostedAiStatusFromBilling(isSignedIn)),
    [sessionPending, isSignedIn],
  )

  return {
    status,
    balanceYuan: meQuery.data?.balance,
    isSignedIn,
    isPending: sessionPending || (isSignedIn && meQuery.isPending),
    isError: meQuery.isError,
  }
}
```

- [ ] **Step 5: built-in-ai-usage 改余额展示**

`src/entrypoints/options/pages/api-providers/built-in-ai-usage/index.tsx` **整体替换**为（原 credits 进度条逻辑全灭，`formatHostedAiResetAtLocal`/`Progress` 等导入随之删除）：

```tsx
import { Button } from "@/components/ui/base-ui/button"
import { Skeleton } from "@/components/ui/base-ui/skeleton"
import { useHostedAiStatus } from "@/components/llm-providers/use-hosted-ai-status"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { ConfigSection } from "../../../components/config-section"

/**
 * billing 时代没有配额池：单余额、扣到零。余额数字 + 充值入口
 * （充值为管理员手动操作，规格 §7.6 的引导式入口）。
 */
export function BuiltInAiUsageConfig() {
  const { isSignedIn, isPending, balanceYuan } = useHostedAiStatus()

  // 未登录用户没有余额可展示；登录引导由 provider 置灰 + 账户页承担。
  if (!isSignedIn) {
    return null
  }

  return (
    <ConfigSection
      id="built-in-ai-usage"
      title={i18n.t("options.apiProviders.builtInAiUsage.title")}
    >
      {isPending ? (
        <Skeleton className="h-13 w-full" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-muted-foreground">{i18n.t("billing.account.balance")}</span>
            <span className="text-base font-medium tabular-nums">¥{balanceYuan ?? "…"}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void sendMessage("openOptionsPage", { route: "/account" })}
          >
            {i18n.t("billing.account.recharge")}
          </Button>
        </div>
      )}
    </ConfigSection>
  )
}
```

- [ ] **Step 6: 移除 Ultra 付费墙徽章**

`src/components/llm-providers/provider-selector.tsx`：删除第 ~91 行 `<PlanBadge plan="ultra" upgradeTooltip={...} />` 及其 import（内置 provider 不再分付费层）。

`src/entrypoints/options/pages/api-providers/providers-config/provider-editor.tsx`：同样删除 ~396 行的 `PlanBadge` Ultra 墙与 import。

（`PlanBadge` 组件本身保留——`AccountNameWithPlan` 已删，若 grep 显示无其他消费者，组件文件保留不删，避免扩大改动面。）

- [ ] **Step 7: 运行确认通过**

Run: `pnpm vitest run src/utils/billing/__tests__/hosted-status-adapter.test.ts src/components/llm-providers src/entrypoints/options/pages/api-providers 2>&1 | tail -5`
Expected: 相关测试全 PASS（既有组件测试若 mock 了 `useHostedAiStatus`/`authClient`，按新接口微调）。

- [ ] **Step 8: Commit**

```bash
git add src/utils/billing/hosted-status-adapter.ts src/utils/billing/__tests__/hosted-status-adapter.test.ts src/components/llm-providers src/entrypoints/options/pages/api-providers
git commit -m "feat(billing): synthesize hosted status from billing; drop ultra paywall"
```

---

### Task 14: changeset + 全量验证

**Files:**

- Create: `.changeset/<auto-name>.md`

- [ ] **Step 1: changeset**

```bash
cd /Users/Luo_F/vs_code/MeowTabby && pnpm changeset
```

若交互式不可用，手写 `.changeset/billing-frontend-slice.md`：

```markdown
---
"@read-frog/extension": minor
---

feat(billing): switch hosted AI to billing-backend with in-extension account

- Hosted text features (page/selection/input/subtitles/summarization/language
  detection) now stream from the billing backend via SSE /v1/generate with
  idempotent retries, cancel linkage and deduct-to-zero settlement
- In-extension account: register with email verification code, log in, reset
  password, balance display and logout (options page Account section)
- Billing channel is rate-limited to one in-flight batch; 402 drains the page
  queue with a recharge prompt, 401 clears the session
- Free channels (DeepL/DeepLX/Google/Microsoft) and BYOK providers unchanged
```

- [ ] **Step 2: 全量测试**

Run: `cd /Users/Luo_F/vs_code/MeowTabby && SKIP_FREE_API=true pnpm test`
Expected: 全 PASS（free-api 按 AGENTS.md 视为有意跳过）。

- [ ] **Step 3: 类型与风格门**

Run: `pnpm lint`
Expected: 无 error（oxlint --type-aware --type-check）。如有格式告警：`pnpm fmt:check` → `pnpm fmt` 后重跑。

- [ ] **Step 4: 冒烟构建**

Run: `pnpm build:edge`（或 `WXT_SKIP_ENV_VALIDATION=true pnpm build:edge`）
Expected: 构建成功；注意——若未设置真实 `WXT_BILLING_API_URL`，产物指向 `.invalid` 占位（见裁决 8），联调前用 `WXT_BILLING_API_URL=http://localhost:8000 pnpm dev:edge`。

- [ ] **Step 5: Commit**

```bash
git add .changeset
git commit -m "chore(billing): changeset for frontend billing slice"
```

---

## 收尾验证清单（执行者完成后逐项自查）

1. `SKIP_FREE_API=true pnpm test` 全绿，且本切片新增测试 ≥ 25 例（session/sse/rest/generate/retry-policy/hosted-status/queues/account/adapter）。
2. `pnpm lint` 干净。
3. 手工联调（规格 §9.3，需后端跑 `ALLOW_DEGRADED_MAIL=1`）：注册→收码激活→登录→见余额→页面翻译流式渲染→`/me` 扣费→余额耗尽当批交付下批 402 停止→取消翻译→重试不双扣→字幕/摘要/语言检测各跑通。
4. 确认不动清单未被触碰：`src/utils/host/translate/api/`（免费通道）、BYOK `ai.ts`、`promptResolver` 组装逻辑、`BatchQueue` 参数。

## 已知影响（记录，不修）

- customAction / noteSuggestion（readfrog 结构化功能）随账户换芯不可用（裁决 2）。
- readfrog notebase / videoTranscript 功能保留原代码，登录态不再由本扩展提供（规格范围外）。
- 后端模型升级需手动升 `BILLING_MODEL_REVISION`（裁决 10）。
