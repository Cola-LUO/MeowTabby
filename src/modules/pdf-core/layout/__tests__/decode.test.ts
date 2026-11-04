import { describe, expect, it } from "vitest"
import { decodeOutput, scaleBoxes, behaviorFor } from "../decode"

describe("decodeOutput", () => {
  it("端到端布局 [1, 6, N]（无 NMS 头）：每列一个候选", () => {
    // N=2：box1 (10,20,110,120) cls=0 conf=0.9；box2 conf 低于阈值被滤
    const N = 2
    const t = new Float32Array(1 * 6 * N)
    const put = (
      i: number,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      cls: number,
      conf: number,
    ) => {
      t[i] = x1
      t[N + i] = y1
      t[2 * N + i] = x2
      t[3 * N + i] = y2
      t[4 * N + i] = cls
      t[5 * N + i] = conf
    }
    put(0, 10, 20, 110, 120, 0, 0.9)
    put(1, 0, 0, 50, 50, 1, 0.1)
    const boxes = decodeOutput(t, [1, 6, N], ["title", "plain text"], 0.5)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toMatchObject({ x1: 10, y1: 20, x2: 110, y2: 120, classId: 0 })
    // conf 以 Float32 存储（0.9 → 0.89999997…），用近似比较
    expect(boxes[0]!.conf).toBeCloseTo(0.9, 6)
  })
  it("行主序端到端布局 [1, N, 6]（实测 DocLayout-YOLO）：x1,y1,x2,y2,conf,cls", () => {
    const t = new Float32Array([
      10,
      20,
      110,
      120,
      0.9,
      2, // cls=2 conf=0.9
      0,
      0,
      50,
      50,
      0.1,
      1, // conf 低于阈值被滤
    ])
    const boxes = decodeOutput(t, [1, 2, 6], ["title", "plain text", "abandon"], 0.5)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toMatchObject({ x1: 10, y1: 20, x2: 110, y2: 120, classId: 2 })
    // conf 以 Float32 存储（0.9 → 0.89999997…），用近似比较
    expect(boxes[0]!.conf).toBeCloseTo(0.9, 6)
  })
  it("YOLOv8 布局 [1, 4+nc, N]（含 NMS 前分数）：取最高分且过阈值", () => {
    // nc 取 3：nc=2 时形状 [1,6,N] 与端到端布局无法按形状区分
    const N = 2,
      nc = 3
    const t = new Float32Array(1 * (4 + nc) * N)
    const put = (i: number, x1: number, y1: number, x2: number, y2: number, scores: number[]) => {
      t[i] = x1
      t[N + i] = y1
      t[2 * N + i] = x2
      t[3 * N + i] = y2
      scores.forEach((s, k) => {
        t[(4 + k) * N + i] = s
      })
    }
    put(0, 10, 20, 110, 120, [0.3, 0.6, 0.05])
    put(1, 0, 0, 50, 50, [0.05, 0.2, 0.1])
    const boxes = decodeOutput(t, [1, 4 + nc, N], ["title", "plain text", "figure"], 0.5)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toMatchObject({ classId: 1 })
    // conf 以 Float32 存储（0.6 → 0.60000002…），用近似比较
    expect(boxes[0]!.conf).toBeCloseTo(0.6, 6)
  })
})

describe("scaleBoxes", () => {
  it("从 1024 letterbox 坐标还原到源图坐标", () => {
    const lb = { scale: 0.5, padX: 32, padY: 0, resizedW: 960, resizedH: 1024 }
    const boxes = scaleBoxes(
      [{ x1: 100, y1: 64, x2: 200, y2: 164, classId: 0, conf: 0.9 }],
      lb,
      1920,
      2048,
    )
    // x = (100 - padX/2)/scale … padX 为总量，居中即各半
    expect(boxes[0]!.x1).toBeCloseTo((100 - 16) / 0.5, 5)
    expect(boxes[0]!.y1).toBeCloseTo(64 / 0.5, 5)
  })
})

describe("behaviorFor", () => {
  it("类别 → 行为映射", () => {
    expect(behaviorFor("title")).toBe("translate")
    expect(behaviorFor("plain text")).toBe("translate")
    expect(behaviorFor("figure")).toBe("keep")
    expect(behaviorFor("table")).toBe("keep")
    expect(behaviorFor("isolate_formula")).toBe("keep")
    expect(behaviorFor("figure_caption")).toBe("translate")
    expect(behaviorFor("abandon")).toBe("skip")
    expect(behaviorFor("unknown-class")).toBe("skip")
  })
})
