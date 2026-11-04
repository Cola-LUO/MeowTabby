# 第 15 页图上方青色段落框

## 症状

`测试PDF全集合并.pdf` 第 15 页在开启“段落的框”后，图上方空白区域出现一个青色虚线框。截图中的红色椭圆是用户标注，不属于验证器绘制。

## 证据

- 第 15 页切片中的 YOLO `figure` 原框是 `x=117.8..499.4, y-down=182.9..591.7`。
- 同页第一条横排标题 `Input-Input Layer5` 的 PDF 坐标约为 `x=107.0, y-up=662.2`，换算为 y-down 后约为 `110`；它在 figure 框的上方，未被 figure keep 区域认领。
- 同页另一条 `Input-Input Layer5` 位于 `y-up≈443.9`，在 figure 框内部。
- `assignItems()` 的认领顺序是 keep 区域先认领，translate 区域随后认领，剩余文字进入 orphan；“段落的框”开关会为这些普通文字段落画 `paragraph-outline`。
- `normalizeItems()` 会跳过旋转文字，因此图内竖排词不会变成普通段落框；截图里的青色框对应的是图外横排标题。

## 归因

代码和切片数据共同证明：青色框来自图外的横排 `Input-Input Layer5` 标题。YOLO 的 figure 框没有覆盖这条标题，导致它被后续文字流程作为普通段落绘制。

原 PDF 的正常渲染结果中看不到这行字。PDF.js 的 operator list 显示它位于 `beginMarkedContentProps("OC", id=3805R)` 的可选内容层中；该层在正常渲染时不显示，但 `getTextContent()` 仍把文字对象返回给文本抽取。因此它不是 CSS 透明，也不是切片错页，而是 PDF 内部的隐藏文本对象。

## 当前状态

本文件只记录归因，未修改代码。
