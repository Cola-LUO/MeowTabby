/**
 * Migration script from v100 to v101.
 *
 * - Retires the Jalapeno Cloud and Tensdaq providers, and reassigns any feature that pointed
 *   at them.
 *
 * Both arrived as sponsor cards, and v098 deliberately seeded Jalapeno into every existing
 * profile rather than only the ones that opted in. v101 drops the two provider types for good
 * and the config schema stops accepting them, so without this step a stored profile would fail
 * validation and be replaced wholesale by the defaults — taking every unrelated setting with it.
 *
 * A feature pointing at a removed provider is reassigned to the first enabled LLM provider that
 * survives, or to the built-in AI when nothing else is left. The built-in AI supports every
 * capability, so a fallback picked this way always validates.
 *
 * IMPORTANT: This is a frozen snapshot. All values and helpers are deliberately inline and it
 * imports nothing from the evolving application code.
 */

const REMOVED_PROVIDER_TYPES = ["jalapenocloud", "tensdaq"]
const REMOVED_PROVIDER_IDS = ["jalapenocloud-default", "tensdaq-default"]
const BUILT_IN_AI_PROVIDER_ID = "read-frog-free-ai"

/** The LLM provider types as v101 leaves them, copied out rather than referenced. */
const LLM_PROVIDER_TYPES = [
  "openai",
  "deepseek",
  "google",
  "anthropic",
  "xai",
  "openai-compatible",
  "open-responses",
  "atlascloud",
  "openrouter",
  "minimax",
  "siliconflow",
  "azure",
  "bedrock",
  "groq",
  "deepinfra",
  "mistral",
  "togetherai",
  "cohere",
  "fireworks",
  "cerebras",
  "replicate",
  "perplexity",
  "vercel",
  "ollama",
  "volcengine",
  "alibaba",
  "moonshotai",
  "huggingface",
]

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function collectRemovedProviderIds(providersConfig: any[]): Set<string> {
  const removedIds = new Set<string>()

  for (const provider of providersConfig) {
    if (!isObject(provider)) continue

    const matchesType = REMOVED_PROVIDER_TYPES.includes(provider.provider)
    const matchesId = REMOVED_PROVIDER_IDS.includes(provider.id)
    if ((matchesType || matchesId) && typeof provider.id === "string") {
      removedIds.add(provider.id)
    }
  }

  return removedIds
}

function pickFallbackProviderId(providersConfig: any[]): string {
  const enabledLlm = providersConfig.find(
    (provider) =>
      isObject(provider) &&
      provider.enabled === true &&
      LLM_PROVIDER_TYPES.includes(provider.provider),
  )

  return typeof enabledLlm?.id === "string" ? enabledLlm.id : BUILT_IN_AI_PROVIDER_ID
}

/**
 * Rewrites every `providerId` that still points at a removed provider. Walking the config
 * rather than naming each feature keeps this snapshot correct for features added after v101.
 */
function rewriteProviderIds(value: any, removedIds: Set<string>, fallbackId: string): any {
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteProviderIds(entry, removedIds, fallbackId))
  }

  if (!isObject(value)) return value

  const rewritten: Record<string, any> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === "providerId" && typeof entry === "string" && removedIds.has(entry)) {
      rewritten[key] = fallbackId
      continue
    }

    rewritten[key] = rewriteProviderIds(entry, removedIds, fallbackId)
  }

  return rewritten
}

export function migrate(oldConfig: any): any {
  if (!isObject(oldConfig) || !Array.isArray(oldConfig.providersConfig)) {
    return oldConfig
  }

  const removedIds = collectRemovedProviderIds(oldConfig.providersConfig)
  if (removedIds.size === 0) {
    return oldConfig
  }

  const providersConfig = oldConfig.providersConfig.filter(
    (provider: any) => !(isObject(provider) && removedIds.has(provider.id)),
  )
  const fallbackId = pickFallbackProviderId(providersConfig)

  return rewriteProviderIds({ ...oldConfig, providersConfig }, removedIds, fallbackId)
}
