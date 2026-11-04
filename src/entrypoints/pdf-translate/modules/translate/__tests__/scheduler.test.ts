// 翻译并发口径（2026-09-14 用户要求）：页内通通并行；页间同时在途不超过两页。
import { describe, expect, it } from "vitest"
import { createTranslateScheduler } from "../scheduler"

interface Pending {
  text: string
  ok: (s: string) => void
  fail: (e: unknown) => void
}

/** 受控 translate：所有请求挂起直到测试放行，同时记录并发峰值 */
function createControlled() {
  let live = 0
  let peak = 0
  const pending: Pending[] = []
  const translate = (text: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      live++
      peak = Math.max(peak, live)
      let settled = false
      pending.push({
        text,
        ok: (s) => {
          if (!settled) {
            settled = true
            live--
            resolve(s)
          }
        },
        fail: (e) => {
          if (!settled) {
            settled = true
            live--
            reject(e)
          }
        },
      })
    })
  return {
    translate,
    peak: () => peak,
    pending: () => pending,
    sent: () => pending.map((p) => p.text),
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe("createTranslateScheduler：页内并行 / 页间两页", () => {
  it("页内：一批文本同时送出（并行度 = 批大小）", async () => {
    const c = createControlled()
    const s = createTranslateScheduler({ translate: c.translate })
    const p = s.fill(["a", "b", "c", "d"])
    await flush()
    expect(c.sent()).toEqual(["a", "b", "c", "d"])
    expect(c.peak()).toBe(4)
    c.pending().forEach((x) => x.ok(`T:${x.text}`))
    const res = await p
    expect(res.issued).toBe(4)
    expect(res.pages).toBe(1)
    expect(s.cache.get("c")).toBe("T:c")
    expect(s.stats().pages).toBe(0)
  })

  it("页间：默认最多两页同时在途，第三页排队（放行后 FIFO 补位）", async () => {
    const c = createControlled()
    const s = createTranslateScheduler({ translate: c.translate })
    const p1 = s.fill(["p1a"])
    const p2 = s.fill(["p2a"])
    const p3 = s.fill(["p3a"])
    await flush()
    expect(c.sent()).toEqual(["p1a", "p2a"]) // 第 3 页还没送出
    expect(s.stats().pages).toBe(2)
    c.pending()[0]!.ok("x") // 放行第 1 页 → 第 3 页立刻补位
    await flush()
    expect(c.sent()).toEqual(["p1a", "p2a", "p3a"])
    c.pending().forEach((x) => x.ok("T"))
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect([r1.issued, r2.issued, r3.issued]).toEqual([1, 1, 1])
    // 闸门口径：任何一页发起请求时，在途页数都不超过上限
    expect(Math.max(r1.pages, r2.pages, r3.pages)).toBeLessThanOrEqual(2)
    expect(s.stats().pages).toBe(0)
  })

  it("页间：maxConcurrentPages=1 → 完全串行（可配）", async () => {
    const c = createControlled()
    const s = createTranslateScheduler({ translate: c.translate, maxConcurrentPages: 1 })
    const p1 = s.fill(["a"])
    const p2 = s.fill(["b"])
    await flush()
    expect(c.sent()).toEqual(["a"])
    c.pending()[0]!.ok("A")
    await flush()
    expect(c.sent()).toEqual(["a", "b"])
    c.pending()[1]!.ok("B")
    await Promise.all([p1, p2])
  })

  it("同文本在途去重：两页同时需要同一段（页眉/版权行）只发一条请求", async () => {
    const c = createControlled()
    const s = createTranslateScheduler({ translate: c.translate })
    const p1 = s.fill(["shared", "only1"])
    const p2 = s.fill(["shared", "only2"])
    await flush()
    expect([...c.sent()].sort()).toEqual(["only1", "only2", "shared"])
    expect(c.sent().filter((t) => t === "shared")).toHaveLength(1)
    c.pending().forEach((x) => x.ok(`T:${x.text}`))
    await Promise.all([p1, p2])
    expect(s.cache.get("shared")).toBe("T:shared") // 两页都等到同一条结果
    expect(s.stats().requests).toBe(3)
  })

  it("失败隔离：单条失败不影响同页其它请求，失败项不入缓存（可重试）", async () => {
    const errs: string[] = []
    const c = createControlled()
    const s = createTranslateScheduler({ translate: c.translate, onError: (_e, t) => errs.push(t) })
    const p = s.fill(["bad", "good"])
    await flush()
    c.pending()
      .find((x) => x.text === "bad")!
      .fail(new Error("429"))
    c.pending()
      .find((x) => x.text === "good")!
      .ok("好")
    expect((await p).issued).toBe(2)
    expect(s.cache.has("bad")).toBe(false)
    expect(s.cache.get("good")).toBe("好")
    expect(errs).toEqual(["bad"])
    const retry = s.fill(["bad"]) // 重试会重新发起
    await flush()
    expect(c.sent().filter((t) => t === "bad")).toHaveLength(2)
    c.pending().at(-1)!.ok("坏")
    expect((await retry).issued).toBe(1)
    expect(s.cache.get("bad")).toBe("坏")
  })

  it("空批 / 全命中缓存 → 不发请求，也不占页名额", async () => {
    const c = createControlled()
    const s = createTranslateScheduler({ translate: c.translate })
    expect((await s.fill([])).issued).toBe(0)
    expect((await s.fill([""])).issued).toBe(0)
    const p = s.fill(["a"])
    await flush()
    c.pending()[0]!.ok("A")
    await p
    expect((await s.fill(["a"])).issued).toBe(0)
    expect(c.sent()).toEqual(["a"])
    expect(s.stats().pages).toBe(0)
  })
})

describe("按页排队后的去重", () => {
  it("等待名额期间前批已经译完的相同文字不再重复请求", async () => {
    const c = createControlled()
    const scheduler = createTranslateScheduler({ translate: c.translate, maxConcurrentPages: 1 })
    const first = scheduler.fill(["shared"])
    const second = scheduler.fill(["shared"])
    await flush()
    expect(c.sent()).toEqual(["shared"])
    c.pending()[0]!.ok("译文")
    await first
    await flush()
    expect(c.sent()).toEqual(["shared"])
    expect((await second).issued).toBe(0)
  })
})

it("已过期的排队批次拿到名额后不再发请求", async () => {
  const c = createControlled()
  const scheduler = createTranslateScheduler({ translate: c.translate, maxConcurrentPages: 1 })
  const first = scheduler.fill(["first"])
  let current = true
  const stale = scheduler.fill(["stale"], () => current)
  current = false
  await flush()
  c.pending()[0]!.ok("译文")
  await first
  await flush()
  expect(c.sent()).toEqual(["first"])
  expect((await stale).issued).toBe(0)
})
