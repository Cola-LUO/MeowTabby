import type { Config } from "@/types/config/config"
import { kebabCase } from "case-anything"
import { defineContentScript, storage } from "#imports"
import { env } from "@/env"
import { getLocalConfig } from "@/utils/config/storage"
import { APP_NAME, EXTENSION_VERSION } from "@/utils/constants/app"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"
import { resolveGuideTargetLanguage } from "@/utils/guide/target-language"
import { logger } from "@/utils/logger"
import { onMessage, sendMessage } from "@/utils/message"
import { startBillingSessionBridge } from "./billing-session-bridge"
import { createExtensionStatusResponse } from "./extension-status"

export default defineContentScript({
  matches: env.WXT_OFFICIAL_SITE_ORIGINS.map((origin: string) => `${origin}/*`),
  async main() {
    const stopBillingSessionBridge = startBillingSessionBridge()
    window.addEventListener("pagehide", stopBillingSessionBridge, { once: true })
    onMessage("pinStateChanged", (msg) => {
      window.postMessage({ source: `${kebabCase(APP_NAME)}-ext`, ...msg }, "*")
    })

    window.addEventListener("message", async (e) => {
      if (e.source !== window) return

      const extensionStatusResponse = createExtensionStatusResponse(e, window, EXTENSION_VERSION)
      if (extensionStatusResponse) {
        window.postMessage(extensionStatusResponse, window.location.origin)
        return
      }

      const { source, type } = e.data || {}
      if (source !== "read-frog-page") return

      if (type === "getPinState") {
        const isPinned = await sendMessage("getPinState", undefined)
        window.postMessage(
          { source: `${kebabCase(APP_NAME)}-ext`, type: "getPinState", data: { isPinned } },
          "*",
        )
      } else {
        const config = await getLocalConfig()
        if (!config) return

        if (type === "setTargetLanguage") {
          const langCodeISO6393 = resolveGuideTargetLanguage(e.data)
          if (!langCodeISO6393) {
            logger.warn("guide setTargetLanguage ignored: missing or invalid language code", e.data)
            return
          }
          // If we set storage too early, react of side content has not been mounted yet,
          // so this set storage will not trigger the watch of storage adapter of atom in react of side content
          // i.e. the side content will not be updated with the new config
          // thus extract query will set the target language back to initial config when it call setLanguage
          await new Promise((resolve) => setTimeout(resolve, 500))
          await storage.setItem<Config>(`local:${CONFIG_STORAGE_KEY}`, {
            ...config,
            language: { ...config.language, targetCode: langCodeISO6393 },
          })
        } else if (type === "getTargetLanguage") {
          const targetLanguage = config.language.targetCode
          window.postMessage(
            {
              source: `${kebabCase(APP_NAME)}-ext`,
              type: "getTargetLanguage",
              data: { targetLanguage },
            },
            "*",
          )
        }
      }
    })
  },
})
