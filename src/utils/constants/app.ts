import { browser } from "#imports"

/** 应用显示名。原值 "Read Frog" 来自上游包 @read-frog/definitions，已本地化为自有品牌。 */
export const APP_NAME = "MeowTabby"
const manifest = browser.runtime.getManifest()
export const EXTENSION_VERSION = manifest.version
