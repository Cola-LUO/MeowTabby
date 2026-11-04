/**
 * 旋转页坐标变换（未旋转帧方案）：
 * 模型区域（显示空间）→ 反变换到未旋转帧供管线处理；
 * 译文块（未旋转帧）→ 正变换（CSS rotate + 定位）回到显示位置。
 * 映射公式用污水检测第 4 页（/Rotate 90，MediaBox 595×794，视口 794×595）实测值钉死，
 * 见 docs/superpowers/specs/2026-09-12-rotated-page-coordinate-unification-design.md
 */

export interface DisplayRect {
  x1: number
  y1: number
  x2: number
  y2: number
}
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 显示空间区域 → 未旋转帧盒子（rotate 90 轴交换，180/270 镜像） */
export function regionToUnrotated(r: DisplayRect, cssW: number, cssH: number, rotate: number): Box {
  const rw = r.x2 - r.x1
  const rh = r.y2 - r.y1
  switch (((rotate % 360) + 360) % 360) {
    case 90:
      return { x: r.y1, y: r.x1, w: rh, h: rw }
    case 180:
      return { x: cssW - r.x2, y: r.y1, w: rw, h: rh }
    case 270:
      return { x: cssH - r.y2, y: cssW - r.x2, w: rh, h: rw }
    default:
      return { x: r.x1, y: r.y1, w: rw, h: rh }
  }
}

export interface BlockDisplay {
  left: number
  top: number
  width: number
  height: number
  rotateDeg: number
}

/** 未旋转帧盒子 → 显示位置与 CSS 旋转。rotate=0 恒等（调用方按原路径渲染） */
export function blockDisplayTransform(
  box: Box,
  _pageWu: number,
  pageHu: number,
  rotate: number,
): BlockDisplay {
  const dW = _pageWu
  const dH = pageHu
  switch (((rotate % 360) + 360) % 360) {
    case 90:
      // rotate(90deg) origin top-left：local [0,w]×[0,h] → displayX ∈ [L-h, L], displayY ∈ [T, T+w]
      return { left: box.y + box.h, top: box.x, width: box.w, height: box.h, rotateDeg: 90 }
    case 180:
      return {
        left: dW - box.x,
        top: box.y + box.h,
        width: box.w,
        height: box.h,
        rotateDeg: 180,
      }
    case 270:
      // rotate(-90deg) origin top-left：local [0,w]×[0,h] → displayX ∈ [L, L+h], displayY ∈ [T-w, T]
      return {
        left: dH - box.y - box.h,
        top: dW - box.x,
        width: box.w,
        height: box.h,
        rotateDeg: -90,
      }
    default:
      return { left: box.x, top: box.y, width: box.w, height: box.h, rotateDeg: 0 }
  }
}
