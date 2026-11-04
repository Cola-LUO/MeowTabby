export interface RawBox {
  x1: number
  y1: number
  x2: number
  y2: number
  classId: number
  conf: number
}

/** 兼容三种输出布局：
 *  - 端到端头 [1, 6, N]：x1,y1,x2,y2,cls,conf（Yv10 无 NMS）
 *  - 行主序端到端 [1, N, 6]：x1,y1,x2,y2,conf,cls（实测 DocLayout-YOLO ONNX 即此布局，无 NMS）
 *  - 传统头 [1, 4+nc, N]：x1,y1,x2,y2, score_class0..n（需 NMS，此处只解码，NMS 见下）
 */
export function decodeOutput(
  tensor: Float32Array,
  shape: readonly number[],
  _names: string[],
  confThreshold: number,
): RawBox[] {
  const out: RawBox[] = []
  if (shape.length === 3 && shape[1] === 6) {
    const n = shape[2]!
    for (let i = 0; i < n; i++) {
      const conf = tensor[5 * n + i]!
      if (conf < confThreshold) continue
      out.push({
        x1: tensor[i]!,
        y1: tensor[n + i]!,
        x2: tensor[2 * n + i]!,
        y2: tensor[3 * n + i]!,
        classId: Math.round(tensor[4 * n + i]!),
        conf,
      })
    }
    return out
  }
  if (shape.length === 3 && shape[2] === 6) {
    const n = shape[1]!
    for (let i = 0; i < n; i++) {
      const r = i * 6
      const conf = tensor[r + 4]!
      if (conf < confThreshold) continue
      out.push({
        x1: tensor[r]!,
        y1: tensor[r + 1]!,
        x2: tensor[r + 2]!,
        y2: tensor[r + 3]!,
        classId: Math.round(tensor[r + 5]!),
        conf,
      })
    }
    return out
  }
  const n = shape[2]!
  const nc = shape[1]! - 4
  for (let i = 0; i < n; i++) {
    let bestId = -1,
      bestConf = 0
    for (let c = 0; c < nc; c++) {
      const s = tensor[(4 + c) * n + i]!
      if (s > bestConf) {
        bestConf = s
        bestId = c
      }
    }
    if (bestConf < confThreshold) continue
    out.push({
      x1: tensor[i]! - tensor[2 * n + i]! / 2,
      y1: tensor[n + i]! - tensor[3 * n + i]! / 2,
      x2: tensor[i]! + tensor[2 * n + i]! / 2,
      y2: tensor[n + i]! + tensor[3 * n + i]! / 2,
      classId: bestId,
      conf: bestConf,
    })
  }
  return nms(out, 0.5)
}

/** 传统头需要 NMS；端到端头输出本身已去重，NMS 无害 */
export function nms(boxes: RawBox[], iouThreshold: number): RawBox[] {
  const sorted = [...boxes].sort((a, b) => b.conf - a.conf)
  const keep: RawBox[] = []
  for (const b of sorted) {
    if (keep.every((k) => iou(k, b) < iouThreshold)) keep.push(b)
  }
  return keep
}

function iou(a: RawBox, b: RawBox): number {
  const x1 = Math.max(a.x1, b.x1),
    y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2),
    y2 = Math.min(a.y2, b.y2)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return inter / Math.max(areaA + areaB - inter, 1e-9)
}

/** letterbox 坐标 → 源图坐标（pad 总量居中，各占一半） */
export function scaleBoxes(
  boxes: RawBox[],
  lb: { scale: number; padX: number; padY: number },
  _srcW: number,
  _srcH: number,
): RawBox[] {
  const px = lb.padX / 2,
    py = lb.padY / 2
  return boxes.map((b) => ({
    ...b,
    x1: (b.x1 - px) / lb.scale,
    y1: (b.y1 - py) / lb.scale,
    x2: (b.x2 - px) / lb.scale,
    y2: (b.y2 - py) / lb.scale,
  }))
}

/** 模型类别清单（DocStructBench 10 类，与 ONNX metadata 的 names 一致） */
export const MODEL_CLASSES = [
  "title",
  "plain text",
  "abandon",
  "figure",
  "figure_caption",
  "table",
  "table_caption",
  "table_footnote",
  "isolate_formula",
  "formula_caption",
] as const

export const CLASS_BEHAVIOR: Record<string, "translate" | "keep" | "skip"> = {
  title: "translate",
  "plain text": "translate",
  figure_caption: "translate",
  table_caption: "translate",
  formula_caption: "translate",
  figure: "keep",
  table: "keep",
  table_footnote: "translate",
  isolate_formula: "keep",
  abandon: "skip",
}

export function behaviorFor(className: string): "translate" | "keep" | "skip" {
  return CLASS_BEHAVIOR[className] ?? "skip"
}
