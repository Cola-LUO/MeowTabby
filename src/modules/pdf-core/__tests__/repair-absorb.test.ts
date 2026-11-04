import type { Region } from "../layout/model-runner"
import type { PdfTextItem } from "../pdf/text-items"
import assert from "node:assert/strict"
import { it } from "vitest"
import { repairRegions } from "../layout/repair"

function item(str: string, x: number, w: number, y = 573.5066, h = 10.5605): PdfTextItem {
  return { str, x, w, y, h, fontName: "", order: 0 }
}

function region(x1: number, x2: number, y1 = 561.601, y2 = 576.201): Region {
  return { x1, x2, y1, y2, className: "plain text", conf: 0.606, behavior: "translate" }
}

it("008 作者行从框内文字边缘连续吸收左侧 24 个字符", () => {
  const items = [
    item("Minghua Nie", 42.633, 63.426363),
    item("a", 107.8299, 4.118556, 575.39538, 7.0396),
    item(", Yi Yang", 111.9685, 43.229407),
    item("b,c", 156.9826, 10.200554, 575.39538, 7.0396),
    item(", Zhijian Zhang", 167.1873, 73.15364),
    item("a", 42.5764, 2.486536, 556.2125, 4.25),
  ]
  const [repaired] = repairRegions([region(179.9, 551.7)], items)
  assert.equal(repaired!.x1, 41.633)
})

it("普通正文行也吸收同行末尾掉出框的字符", () => {
  const items = [item("anchor", 145, 20), item("3", 167, 5), item("next line", 145, 40, 562.5966)]
  const [repaired] = repairRegions([region(100, 160)], items)
  assert.equal(repaired!.x2, 173)
})

it("扩框将碰到其他框时停在上一次成功吸收的位置", () => {
  const target = region(100, 160, 560, 580)
  const blocker = region(82, 86, 560, 580)
  const items = [item("anchor", 95, 30), item("near", 88, 7), item("left", 76, 5)]
  const [repaired] = repairRegions([target, blocker], items)
  assert.equal(repaired!.x1, 87)
})

it("向右碰到其他框时停止，保留之前吸收的字符", () => {
  const target = region(100, 160, 560, 580)
  const blocker = region(176, 180, 560, 580)
  const items = [item("anchor", 145, 20), item("near", 167, 4), item("blocked", 172.5, 3)]
  const [repaired] = repairRegions([target, blocker], items)
  assert.equal(repaired!.x2, 172)
})

it("向右吸收遇到超过 10 的空白时停止", () => {
  const items = [item("anchor", 145, 20), item("near", 167, 4), item("far", 183, 3)]
  const [repaired] = repairRegions([region(100, 160)], items)
  assert.equal(repaired!.x2, 172)
})

it("每侧吸收达到 25 字上限后停止", () => {
  const items = [
    item("anchor", 145, 20),
    item("abcdefghijklmnopqrstuvwx", 167, 4),
    item("YZ", 172, 3),
  ]
  const [repaired] = repairRegions([region(100, 160)], items)
  assert.equal(repaired!.x2, 172)
})
