/**
 * 打印式 PDF 导出（零依赖、真文本可选）。
 *
 * 路线：构建隐藏的 #print-root DOM → 注入 @media print 规则让它独占打印页 → window.print()。
 * 译文层保留为真 DOM（可选取、可搜索），原文 canvas 转 PNG 位图（toBlob + createObjectURL，
 * 避免 toDataURL 在大文档下的 base64 体积膨胀 + OOM 风险）。纸张尺寸按原 PDF 页比例定制
 * （@page size: Wmm Hmm，mm 精度高于 px）。
 *
 * 两种模式：
 *   - "translation"：仅右栏视觉（白底译文 + keep 区透出的原文）
 *   - "bilingual"  ：左栏原文 + 右栏译文，两栏并排一页
 */

/** 单页导出数据（与 main.ts 内部 PageState 解耦） */
export interface ExportPageData {
  cssW: number
  cssH: number
  leftCanvas: HTMLCanvasElement
  rightTransLayer: HTMLElement
}

/** 构建隐藏打印根容器；调用方保证所有需导出的页已走完推理 + 译文回填 */
export async function buildPrintRoot(
  pages: ExportPageData[],
  mode: "translation" | "bilingual",
  /** 每处理 N 页主动让出一次主线程，避免大文档阻塞 UI（默认 5） */
  yieldEvery = 5,
): Promise<{
  root: HTMLElement
  /** createObjectURL 生成的 blob URL 列表，window.print() 后统一 revoke */
  objectUrls: string[]
  pageCssW: number
  pageCssH: number
}> {
  const root = document.createElement("div")
  root.id = "print-root"
  // visibility:hidden + position:fixed 隐藏定位：打印前不出现在屏幕上，但 DOM 已完整渲染
  root.style.cssText = "position:fixed;left:-9999px;top:0;visibility:hidden"
  const objectUrls: string[] = []

  const first = pages[0]
  if (!first) return { root, objectUrls, pageCssW: 595, pageCssH: 842 }
  const pageCssW = first.cssW
  const pageCssH = first.cssH

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!
    // 每 yieldEvery 页让出一次主线程：防止 300+ 页文档一次性 toBlob + DOM 构建卡 UI
    if (yieldEvery > 0 && i % yieldEvery === 0 && i > 0) {
      await new Promise<void>((r) => setTimeout(r, 0))
    }
    const wrapper = await buildPageWrapper(p, mode, objectUrls)
    root.appendChild(wrapper)
  }

  return { root, objectUrls, pageCssW, pageCssH }
}

/** 构建单页 DOM（内部 async：canvas toBlob 是异步的） */
async function buildPageWrapper(
  p: ExportPageData,
  mode: "translation" | "bilingual",
  objectUrls: string[],
): Promise<HTMLElement> {
  // pt→打印 px 缩放：pdf.js 的 cssW/cssH 是 PDF points（72/in），打印引擎按 CSS px（96/in）
  // 输出 PDF（1px=0.75pt）。外层布局尺寸与 @page 用 ×4/3 的 px、内层内容按原 px 排版再
  // transform:scale(4/3)，导出 PDF 的 MediaBox 恰好等于原 PDF 的 pt 尺寸，内容满页零缩水。
  const SCALE = 4 / 3
  const totalW = mode === "bilingual" ? p.cssW * 2 : p.cssW
  const totalH = p.cssH

  const wrapper = document.createElement("div")
  wrapper.className = "print-page-wrapper"
  wrapper.style.cssText =
    `position:relative;width:${totalW * SCALE}px;height:${totalH * SCALE}px;background:#fff;` +
    `overflow:hidden;break-after:page;margin:0;padding:0`

  const inner = document.createElement("div")
  inner.className = "print-page-inner"
  inner.style.cssText =
    `position:absolute;left:0;top:0;width:${totalW}px;height:${totalH}px;` +
    `transform:scale(${SCALE});transform-origin:0 0`
  wrapper.appendChild(inner)

  // 左栏（双语模式独占左半边）
  if (mode === "bilingual") {
    const leftPane = document.createElement("div")
    leftPane.className = "print-pane print-pane-left"
    leftPane.style.cssText = `position:absolute;left:0;top:0;width:${p.cssW}px;height:${p.cssH}px`
    const img = await canvasToImgElement(p.leftCanvas, p.cssW, p.cssH, objectUrls)
    leftPane.appendChild(img)
    inner.appendChild(leftPane)
  }

  // 右栏（两种模式都要，仅译文模式贴左边）
  const rightPane = document.createElement("div")
  rightPane.className = "print-pane print-pane-right"
  const rightLeft = mode === "bilingual" ? p.cssW : 0
  rightPane.style.cssText = `position:absolute;left:${rightLeft}px;top:0;width:${p.cssW}px;height:${p.cssH}px`

  // 右栏底层：canvas 原文图（keep 区域透出，译文 cluster 白底覆盖可翻译区）
  const rightCanvasImg = await canvasToImgElement(p.leftCanvas, p.cssW, p.cssH, objectUrls)
  rightPane.appendChild(rightCanvasImg)

  // 右栏顶层：译文层 clone
  // transLayer 本身是 position:absolute;inset:0;z-index:10，clone 后相对于 rightPane 铺满
  const transClone = p.rightTransLayer.cloneNode(true) as HTMLElement
  transClone.style.visibility = "visible" // 父级 visibility:hidden 继承；clone 显式覆盖保证子元素可见
  rightPane.appendChild(transClone)

  inner.appendChild(rightPane)
  return wrapper
}

/** canvas → <img>（toBlob + createObjectURL：零 base64 膨胀，内存效率最高）
 *  返回前 await img.decode()，保证后续 window.print() 时图片已完全解码，不会打出空白页 */
async function canvasToImgElement(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  objectUrls: string[],
): Promise<HTMLImageElement> {
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("canvas.toBlob 返回空（导出失败）")
  const url = URL.createObjectURL(blob)
  objectUrls.push(url)
  const img = document.createElement("img")
  img.src = url
  // 保证图像解码完成再返回——否则 window.print() 可能打出空白页（尤其大文档图片尚未 load）
  try {
    await img.decode()
  } catch {
    // Safari 不支持 img.decode()，用 onload 兜底
    await new Promise<void>((resolve) => {
      img.onload = () => resolve()
      // 已经 onload 过的情况（createObjectURL 从缓存瞬间取到）
      if (img.complete) resolve()
    })
  }
  img.style.cssText = `position:absolute;left:0;top:0;width:${cssW}px;height:${cssH}px;display:block`
  return img
}

/** 注入 @media print 规则。
 *  所有关键属性必须 !important：#print-root 的隐藏定位是内联样式，普通规则压不过它
 *  （2026-09-24 实测归因：print 媒体下 computedPosition 仍是 fixed、computedLeft 仍 -9999px，
 *  打印全空白）。#print-root 改 static 回文档流，分页由每页 wrapper 的 break-after 驱动。
 *  @page 用 px：wrapper 布局尺寸已是 ×4/3 的打印 px（见 buildPageWrapper），恰好铺满整页。 */
function injectPrintRules(
  pageCssW: number,
  pageCssH: number,
  mode: "translation" | "bilingual",
): HTMLStyleElement {
  const SCALE = 4 / 3
  const printW = (mode === "bilingual" ? pageCssW * 2 : pageCssW) * SCALE
  const printH = pageCssH * SCALE
  const style = document.createElement("style")
  style.id = "print-export-rules"
  style.textContent = `
    @page { size: ${printW}px ${printH}px; margin: 0; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; }
      body > *:not(#print-root) { display: none !important; }
      #print-root {
        position: static !important;
        left: auto !important;
        top: auto !important;
        visibility: visible !important;
        width: auto !important;
      }
      #print-root * { visibility: visible !important; }
    }
  `
  document.head.appendChild(style)
  return style
}

/** 触发浏览器打印。清理挂在 afterprint（Chrome/Firefox）+ focus（Safari 兜底）上。
 *  打印期间把 body 其余子元素逐个 inline display:none（2026-09-24 实测：@media print 的
 *  body>* 选择器规则在打印引擎渲染中未生效——模拟 print 下 computed display 是 none，
 *  printToPDF 产物里 #app 的 canvas 仍被绘制；inline style 不依赖媒体查询，必然生效）。 */
export async function triggerPrint(
  root: HTMLElement,
  filename: string,
  pageCssW: number,
  pageCssH: number,
  mode: "translation" | "bilingual",
  objectUrls: string[],
): Promise<void> {
  const hiddenSiblings: Array<[HTMLElement, string]> = []
  for (const child of Array.from(document.body.children)) {
    if (child === root) continue
    const el = child as HTMLElement
    hiddenSiblings.push([el, el.style.cssText])
    el.style.display = "none"
  }
  document.body.appendChild(root)
  const rules = injectPrintRules(pageCssW, pageCssH, mode)

  const origTitle = document.title
  document.title = filename

  const cleanup = () => {
    try {
      document.body.removeChild(root)
    } catch {
      /* already removed */
    }
    try {
      document.head.removeChild(rules)
    } catch {
      /* already removed */
    }
    for (const [el, css] of hiddenSiblings) {
      el.style.cssText = css
    }
    for (const url of objectUrls) URL.revokeObjectURL(url)
    document.title = origTitle
  }

  const onAfterPrint = () => {
    window.removeEventListener("afterprint", onAfterPrint)
    window.removeEventListener("focus", onFocusFallback)
    cleanup()
  }
  const onFocusFallback = () => setTimeout(onAfterPrint, 300)
  window.addEventListener("afterprint", onAfterPrint)
  window.addEventListener("focus", onFocusFallback, { once: true })

  window.print()
}
