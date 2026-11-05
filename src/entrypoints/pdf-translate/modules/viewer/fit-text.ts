/** 合并组译文按目标盒容量分配（2026-09-16 建，2026-09-17 改为**字符级**）。
 *
 *  取代两版旧法：① "按原文各 part 字符长度占比切分"（splitByRatio）——看不见盒的可用空间；
 *  ② "句子级按容量切分"——有"整句推走"效应（下一句放不下就整句丢给后盒，前盒留 ≥ 半句空白，
 *  后盒又更容易溢出），正是"留大片空白"与"白盒长出去压住别人"两个症状的共同来源。
 *
 *  用户口径（逐条落到本文件）：
 *  ① **前盒优先**：按 part 顺序，每个前盒吃到"自己的可用容量上限"为止（能放多少放多少）；
 *     —— 本页原文对应的译文尽量留在本页，不会整段被挪到下一页（"多放一些在前面那块，反正也在底部"）；
 *  ② 后盒（阅读序最后一个 part）只拿剩余量，**必然不超过其硬容量**（= 原位高，绝不长高）；
 *  ③ 前盒可用高可含"到下方障碍的距离"（调用方用 obstacles.ts 算好）；后盒不享受下吃空间；
 *  ④ 后盒放不下剩余量 / 总容量不足 → **整组统一缩字号**（等比档位，下限约 0.6）后重算，绝不截断；
 *  ⑤ 每个盒**保底 MIN_CHARS 字**（后盒零字会露出未翻译原文、前盒零字会白底盖住原文，两者都不可接受）；
 *  ⑥ 粒度 = **字符**（用户 2026-09-17 明确接受"把句子劈开"）：切分只发生在**显示层**，
 *     送翻仍是整段一条请求（模型看到完整句子），所以不损失翻译质量；断点落在栏缝/页缝处，
 *     而原文本来就是在这里断的。
 *
 *  宽度/行高是估算（jsdom 无布局引擎，不能读 offsetWidth）：口径唯一来源是 text-metrics.ts
 *  （CJK 1em、ASCII 0.55em、空格 0.28em、其他 0.6em；单行高 = fontSize × 1.3），
 *  与 cluster-layout.ts 的求解器同源 —— 两处若各留一份，会出现"装箱说装得下、求解说装不下"。
 *  估算偏保守（宁可提前换行），最终由调用方在渲染后做一次实测复核。 */

import { LINE_HEIGHT, rowsNeeded } from "./text-metrics"

// 度量口径唯一来源是 text-metrics.ts；这里 re-export 保住既有 import 路径
export { LINE_HEIGHT } from "./text-metrics"

/** 缩字号档位（等比，下限约 0.6）：整组统一作用，视觉一致 */
export const SCALE_STEPS: number[] = [1, 0.9, 0.81, 0.73, 0.66]

/** 每盒保底字符数：防"孤字盒"——一盒里只有两三个字，比留白更难看；
 *  同时保证"后盒零字露出未翻译原文"不会发生 */
export const MIN_CHARS = 4

/** 切点软化的搜索窗口（字符）：只在这个范围内回退，回退太远会反过来留下空白 */
const SOFTEN_WINDOW = 6

/** 分配输入：一个 part 的目标盒 */
export interface PartBox {
  /** 盒宽（CSS px） */
  width: number
  /** 盒可用总高（CSS px）：后盒 = 原位高；前盒 = 原位高 + 到下方障碍的距离 */
  availHeight: number
  /** 盒内基准字号 */
  fontSize: number
  lineHeight?: number
}

export interface FitResult {
  /** 与 parts 同序，各盒该写的文本（拼接 = 原译文，不丢字） */
  pieces: string[]
  /** 整组统一字号档位（1 = 不缩） */
  scale: number
}

/** 盒在该档位下能写几行（**至少 1 行**：原文单行段 h≈10 < 行高 11.7，不夹会算出 0 行） */
function rowsAvailable(box: PartBox, scale: number): number {
  return Math.max(
    1,
    Math.floor(box.availHeight / (box.fontSize * scale * (box.lineHeight ?? LINE_HEIGHT))),
  )
}

/** 该盒在档位 scale 下能容纳的字符数：二分最长前缀使折行数 ≤ 可用行数
 *  （前缀越长行数不降 → 单调，二分合法）。取代旧实现的"行数 × floor(宽/字号)"矩形近似。 */
export function maxChars(text: string, box: PartBox, scale: number): number {
  const fs = box.fontSize * scale
  const rows = rowsAvailable(box, scale)
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (rowsNeeded(text.slice(0, mid), fs, box.width) <= rows) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** 字符配额：每盒先拿 minChars，前盒按 caps 吃满（仍为后面每盒预留 minChars），末盒吃全部剩余。
 *  `caps` 与盒数等长；**末盒那一项不参与分配**（它吸收剩余，由调用方拿硬容量校验）。
 *  末盒不设配额上限，吸收全部剩余字符。 */
export function allocateChars(total: number, caps: number[], minChars: number): number[] {
  const n = caps.length
  if (n === 0) return []
  const floorTotal = minChars * n
  if (total <= floorTotal) {
    // 总量连保底都不够 → 均分退化（余数给前盒），绝不产生负数
    const base = Math.floor(total / n)
    const out = new Array<number>(n).fill(base)
    for (let i = 0; i < total - base * n; i++) out[i] = out[i]! + 1
    return out
  }
  const counts = new Array<number>(n).fill(minChars)
  let left = total - floorTotal
  for (let k = 0; k < n - 1; k++) {
    const extra = Math.max(0, Math.min(caps[k]! - minChars, left))
    counts[k] = counts[k]! + extra
    left -= extra
  }
  counts[n - 1] = counts[n - 1]! + left
  return counts
}

const CN_STOP = /[。！？；：，、）】》」』…]/

/** 切点软化：把**最后一个切点**左移到最近的标点/空格（窗口 ≤ SOFTEN_WINDOW），Σ 不变、不压破 minChars。
 *  中文看停顿/句末标点；拉丁文**必须**回退到空格，否则输出会出现 "transla|tion" 断词。
 *
 *  为什么只软化最后一个切点：软化会把字从切点前的盒转给切点后的盒（这里就是末盒）。多 part 时若
 *  移动中间切点，其后各盒内容会连锁左移、可能顶破各自的硬容量；而"跨栏/跨页同段"要软化的正是
 *  栏缝/页缝那一处，即最后一个切点。
 *  调用方还须校验末盒硬容量（软化的受益方是末盒）——越界就放弃软化，见 splitByCapacity。 */
export function softenCutPoints(text: string, counts: number[], minChars: number): number[] {
  const out = [...counts]
  const k = out.length - 2
  if (k < 0) return out
  let pos = 0
  for (let i = 0; i < k; i++) pos += out[i]!
  const cut = pos + out[k]!
  let best = cut
  for (let d = 0; d <= SOFTEN_WINDOW; d++) {
    const c = cut - d
    if (c <= pos + minChars) break
    if (text[c] === " " || text[c - 1] === " " || CN_STOP.test(text[c - 1] ?? "")) {
      best = c
      break
    }
  }
  const delta = cut - best
  if (delta > 0) {
    out[k] = out[k]! - delta
    out[out.length - 1] = out[out.length - 1]! + delta
  }
  return out
}

/** counts → 文本片段（顺序切片；counts 之和应等于文本长度） */
function sliceByCounts(text: string, counts: number[]): string[] {
  const out: string[] = []
  let pos = 0
  for (const c of counts) {
    out.push(text.slice(pos, pos + Math.max(0, c)))
    pos += Math.max(0, c)
  }
  return out
}

/** 总容量不足时的兜底：按各盒容量比例切（每盒轻微溢出、均匀分担，由盒内滚动兜底）。
 *  旧实现里它是"句子数 < 盒数"的退化路径，字符级后升级为"总容量不足"的主兜底路径。 */
function ratioSplit(text: string, parts: PartBox[]): string[] {
  if (text === "") return parts.map(() => "")
  const caps = parts.map((b) => Math.max(1, maxChars(text, b, 1)))
  const total = caps.reduce((a, b) => a + b, 0)
  const out: string[] = []
  let pos = 0
  for (let i = 0; i < parts.length; i++) {
    const take =
      i === parts.length - 1 ? text.length - pos : Math.round((text.length * caps[i]!) / total)
    out.push(text.slice(pos, pos + Math.max(0, take)))
    pos += Math.max(0, take)
  }
  return out
}

/**
 * 按目标盒容量切分译文（用户口径见文件头）。
 * `parts` 顺序 = part 顺序 = 阅读顺序（先上页/左栏尾段，后下页/右栏首段）；最后一个元素是"后盒"。
 */
export function splitByCapacity(
  translated: string,
  parts: PartBox[],
  opts: { scales?: number[] } = {},
): FitResult {
  if (parts.length === 0) return { pieces: [], scale: 1 }
  if (parts.length === 1) return { pieces: [translated], scale: 1 }
  if (translated.trim() === "") return { pieces: parts.map(() => ""), scale: 1 }

  const scales = opts.scales ?? SCALE_STEPS
  for (const scale of scales) {
    const caps = parts.map((b) => maxChars(translated, b, scale))
    if (caps.reduce((sum, cap) => sum + cap, 0) < translated.length) continue
    const counts = caps.map(() => 0)
    for (let i = 0; i < translated.length; i++) {
      let best = -1
      for (let k = 0; k < caps.length; k++) {
        if (counts[k]! >= caps[k]!) continue
        if (best < 0 || counts[k]! / caps[k]! < counts[best]! / caps[best]!) best = k
      }
      counts[best]!++
    }
    return { pieces: sliceByCounts(translated, counts), scale }
  }
  // 全档失败：总容量 < 总内容 → 比例兜底（每盒轻微溢出，各自盒内滚动兜底）
  return { pieces: ratioSplit(translated, parts), scale: scales[scales.length - 1]! }
}
