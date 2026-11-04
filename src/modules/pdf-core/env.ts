import { browser } from "#imports"

/** 共用静态资源地址；扩展与本地验证页面使用同一入口。 */
export function extUrl(path: string): string {
  const runtime = browser?.runtime
  if (runtime?.getURL) return runtime.getURL(path as "/popup.html")
  if (typeof location !== "undefined") return new URL(path, location.href).href
  return path
}
