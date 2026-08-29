import { IconSettings } from "@tabler/icons-react"
import { useAtom, useAtomValue } from "jotai"
import { browser } from "#imports"
import { useHostedAiProviderOptions } from "@/components/llm-providers/use-hosted-ai-provider-options"
import ProviderIcon from "@/components/provider-icon"
import { useTheme } from "@/components/providers/theme-provider"
import { Button } from "@/components/ui/base-ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import {
  filterEnabledProvidersConfig,
  getLLMProvidersConfig,
  getNonAPIProvidersConfig,
  getPureAPIProvidersConfig,
  getTranslateProvidersConfig,
} from "@/utils/config/helpers"
import { PROVIDER_ITEMS } from "@/utils/constants/providers"
import { i18n } from "@/utils/i18n"
import {
  getProviderLogo,
  getProviderName,
  isProviderSelectorOptionDisabled,
  isSystemProviderSelectorItem,
} from "@/utils/providers/provider-display"
import { getSelectableProvidersForCapability } from "@/utils/providers/provider-registry"
import { selectedProviderIdsAtom } from "../atoms"

export function TranslationServiceDropdown() {
  const { theme } = useTheme()
  const [selectedIds, setSelectedIds] = useAtom(selectedProviderIdsAtom)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)
  const translateProviders = getTranslateProvidersConfig(providersConfig)
  const filteredProvidersConfig = filterEnabledProvidersConfig(translateProviders)

  // The built-in AI providers have no row in providersConfig — they come from
  // the registry, and the hosted-status hook grays them out on durable account
  // walls (signed out / Ultra-gated) exactly like the other provider dropdowns.
  const builtInProviders = useHostedAiProviderOptions(
    "translationHub",
    getSelectableProvidersForCapability("translationHub", providersConfig).filter(
      isSystemProviderSelectorItem,
    ),
  )
  const builtInUnavailable = builtInProviders.some(isProviderSelectorOptionDisabled)

  const handleConfigureAPI = async () => {
    try {
      await browser.tabs.create({
        url: browser.runtime.getURL("/options.html#/api-providers"),
      })
    } catch (error) {
      console.error("Error opening configure API:", error)
    }
  }

  const llmProviders = getLLMProvidersConfig(filteredProvidersConfig)
  const nonAPIProviders = getNonAPIProvidersConfig(filteredProvidersConfig)
  const pureAPIProviders = getPureAPIProvidersConfig(filteredProvidersConfig)

  return (
    <div className="flex items-center gap-2">
      <Select multiple value={selectedIds} onValueChange={setSelectedIds}>
        <SelectTrigger className="min-w-52">
          <SelectValue placeholder={i18n.t("translateService.selectServices")}>
            {selectedIds.length > 0 ? (
              <div className="flex items-center gap-2">
                <span>{i18n.t("translateService.translationProviders")}</span>
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                  {selectedIds.length}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">
                {i18n.t("translateService.selectServices")}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {llmProviders.length > 0 && (
            <SelectGroup>
              <SelectLabel>{i18n.t("translateService.llmModels")}</SelectLabel>
              {llmProviders.map(({ id, name, provider }) => (
                <SelectItem key={id} value={id}>
                  <ProviderIcon logo={PROVIDER_ITEMS[provider].logo(theme)} name={name} size="sm" />
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {(nonAPIProviders.length > 0 || pureAPIProviders.length > 0) && (
            <SelectGroup>
              <SelectLabel>{i18n.t("translateService.normalTranslator")}</SelectLabel>
              {nonAPIProviders.map(({ id, name, provider }) => (
                <SelectItem key={id} value={id}>
                  <ProviderIcon logo={PROVIDER_ITEMS[provider].logo(theme)} name={name} size="sm" />
                </SelectItem>
              ))}
              {pureAPIProviders.map(({ id, name, provider }) => (
                <SelectItem key={id} value={id}>
                  <ProviderIcon logo={PROVIDER_ITEMS[provider].logo(theme)} name={name} size="sm" />
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {builtInProviders.length > 0 && (
            <SelectGroup>
              <SelectLabel>{i18n.t("translateService.builtInModels")}</SelectLabel>
              {builtInProviders.map((item) => (
                <SelectItem
                  key={item.id}
                  value={item.id}
                  disabled={isProviderSelectorOptionDisabled(item)}
                >
                  <ProviderIcon
                    logo={getProviderLogo(item, theme)}
                    name={getProviderName(item)}
                    size="sm"
                  />
                </SelectItem>
              ))}
              {builtInUnavailable && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  {i18n.t("hostedAi.availability.authenticationRequired")}
                </p>
              )}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="icon"
        onClick={handleConfigureAPI}
        title={i18n.t("translateService.configureAPI")}
      >
        <IconSettings />
      </Button>
    </div>
  )
}
