export interface PageHost {
  root: HTMLElement
  canvas: HTMLCanvasElement
  selectLayer: HTMLElement
  transLayer: HTMLElement
}

export function createPageHost(
  doc: Document,
  cssW: number,
  cssH: number,
  canvas: HTMLCanvasElement,
): PageHost {
  const root = doc.createElement("div")
  root.className = "page-host"
  root.style.cssText = "position:relative;background:#fff"
  root.style.width = `${cssW}px`
  root.style.height = `${cssH}px`
  canvas.style.cssText = "position:absolute;left:0;top:0"
  canvas.className = "page-canvas"
  root.appendChild(canvas)
  const mk = (cls: string, z: string) => {
    const el = doc.createElement("div")
    el.className = cls
    el.style.cssText = `position:absolute;inset:0;z-index:${z}`
    root.appendChild(el)
    return el
  }
  // trans 层默认 click-through：仅单个 .trans-block 命中指针事件（空白处可点选原图）
  const selectLayer = mk("select-layer textLayer", "2")
  const transLayer = mk("trans-layer", "10")
  transLayer.style.pointerEvents = "none"
  return { root, canvas, selectLayer, transLayer }
}

// renderBlocks 实现在 render-view.ts；此处 re-export 以匹配测试导入路径
export { renderBlocks } from "./render-view"
