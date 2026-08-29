import { useAtom, useAtomValue } from "jotai"
import { getPageTranslatePromptSelectItems } from "@/components/prompt-configurator/built-in-prompts"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { isLLMProvider } from "@/types/config/provider"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { DEFAULT_TRANSLATE_PROMPT_ID } from "@/utils/constants/prompt"
import { i18n } from "@/utils/i18n"
import { isBuiltInAiProviderId } from "@/utils/providers/provider-registry"
import { selectedProviderIdsAtom, selectedProvidersAtom } from "../atoms"

export function PromptSelector() {
  const selectedProviders = useAtomValue(selectedProvidersAtom)
  const selectedProviderIds = useAtomValue(selectedProviderIdsAtom)
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.pageTranslation)

  // Only show when at least one LLM provider is selected. Built-in AI has no
  // local config row, so it never appears in selectedProviders — the selected
  // ids are what reveal it, and it is a hosted LLM like any other here.
  const hasLLMProvider =
    selectedProviders.some((p) => isLLMProvider(p.provider)) ||
    selectedProviderIds.some((id) => isBuiltInAiProviderId(id))
  if (!hasLLMProvider) return null

  const { patterns, promptId } = translateConfig.customPromptsConfig
  const items = getPageTranslatePromptSelectItems(patterns)
  const selectedItem = items.find(({ value }) => value === promptId) ?? items[0]

  return (
    <Select
      items={items}
      value={promptId ?? DEFAULT_TRANSLATE_PROMPT_ID}
      onValueChange={(value) => {
        void setTranslateConfig({
          customPromptsConfig: {
            ...translateConfig.customPromptsConfig,
            promptId: value ?? DEFAULT_TRANSLATE_PROMPT_ID,
          },
        })
      }}
    >
      <SelectTrigger className="w-36">
        <SelectValue placeholder={i18n.t("translatePrompt.title")}>
          <span className="truncate">
            {selectedItem?.label ?? i18n.t("options.translation.personalizedPrompts.default")}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
