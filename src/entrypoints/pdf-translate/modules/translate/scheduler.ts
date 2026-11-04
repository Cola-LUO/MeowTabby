/** 翻译并发调度（2026-09-14 用户口径）：
 *   ① 页内：一页之内的文字**通通并行**送出（一批 = 一页，批内 Promise.all）；
 *   ② 页间：同时进行的**页数不超过两页**（超出者在闸门排队，FIFO）。
 *  另外两个必要的配套：
 *   - 同文本在途去重：多页/多次同时需要同一段文字（页眉、版权行这类跨页重复）时只发一条请求；
 *   - 失败隔离：单条失败只记录 + 不缓存（下次重试），不影响同页其它请求。
 *  纯调度层，不关心翻译实现（`translate` 注入，便于单测）。 */

export interface TranslateSchedulerOptions {
  translate: (text: string) => Promise<string>
  /** 页间并发上限，默认 2（用户口径：不超过两页） */
  maxConcurrentPages?: number
  /** 单条失败回调（默认静默：失败不入缓存，后续重渲染会重试） */
  onError?: (err: unknown, text: string) => void
}

export interface FillResult {
  /** 本次**新发起**的请求数（命中缓存或复用在途请求的不计） */
  issued: number
  /** 发起时在途的批数（含本页），用于日志核对页间闸门 */
  pages: number
}

export interface TranslateScheduler {
  /** 已拿到的译文（只含成功项：失败不缓存，便于重试） */
  readonly cache: Map<string, string>
  /** 把这一批（= 一页）里所有未缓存的文本**并行**送出。
   *  返回时：成功项已写入 cache，失败项已交给 onError 且未缓存。 */
  fill(texts: string[], isCurrent?: () => boolean): Promise<FillResult>
  /** 观测：当前在途批数 / 累计请求数（调试与单测用） */
  stats(): { pages: number; requests: number }
}

export function createTranslateScheduler(opts: TranslateSchedulerOptions): TranslateScheduler {
  const maxPages = Math.max(1, opts.maxConcurrentPages ?? 2)
  const cache = new Map<string, string>()
  const inFlight = new Map<string, Promise<void>>()
  const waiters: Array<() => void> = []
  let pages = 0
  let requests = 0

  /** 取一个"页名额"：页间并发闸门 */
  const acquirePage = async (): Promise<void> => {
    // oxlint-disable-next-line no-unmodified-loop-condition -- 等待闸门：pages 在 releasePage 回调里减，循环体内不改，属误报
    while (pages >= maxPages) await new Promise<void>((r) => waiters.push(r))
    pages++
  }
  const releasePage = (): void => {
    pages--
    waiters.shift()?.() // FIFO 唤醒下一个排队页
  }

  /** 单条请求（在途去重：同文本复用在途 Promise，不重复发） */
  const request = (text: string): { p: Promise<void>; issued: boolean } => {
    const running = inFlight.get(text)
    if (running) return { p: running, issued: false }
    requests++
    const p = opts
      .translate(text)
      .then(
        (out) => {
          cache.set(text, out)
        },
        (err: unknown) => {
          opts.onError?.(err, text)
        },
      )
      .finally(() => {
        inFlight.delete(text)
      })
    inFlight.set(text, p)
    return { p, issued: true }
  }

  return {
    cache,
    async fill(texts, isCurrent = () => true) {
      const missing = [...new Set(texts.filter((t) => t !== "" && !cache.has(t)))]
      if (missing.length === 0) return { issued: 0, pages }
      await acquirePage()
      try {
        if (!isCurrent()) return { issued: 0, pages }
        const calls = missing.filter((text) => !cache.has(text)).map(request) // 页内全并行：一次全部发出
        const atIssue = pages // 发起时的在途页数（含本页），日志核对闸门用
        await Promise.all(calls.map((c) => c.p))
        return { issued: calls.filter((c) => c.issued).length, pages: atIssue }
      } finally {
        releasePage()
      }
    },
    stats: () => ({ pages, requests }),
  }
}
