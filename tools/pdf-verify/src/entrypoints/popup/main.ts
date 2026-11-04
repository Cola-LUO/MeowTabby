import { browser } from "wxt/browser"

const url = browser.runtime.getURL("/pdf-verify.html")
void browser.tabs
  .create({ url })
  .then(() => window.close())
  .catch(() => {
    const app = document.getElementById("app")!
    const link = document.createElement("a")
    link.href = url
    link.target = "_blank"
    link.textContent = "点这里打开验证页"
    app.replaceChildren(link)
  })
