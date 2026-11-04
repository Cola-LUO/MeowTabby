import type { APIProviderTypes } from "@/types/config/provider"
import ProviderIcon from "@/components/provider-icon"
import { useTheme } from "@/components/providers/theme-provider"
import { PROVIDER_ITEMS, getProviderItemName } from "@/utils/constants/providers"
import { i18n } from "@/utils/i18n"

export function ConfigHeader({
  providerType,
}: {
  providerType: APIProviderTypes
  apiKey?: string
}) {
  const { theme } = useTheme()
  const providerItem = PROVIDER_ITEMS[providerType]
  const hasWebsite = Boolean(providerItem.website)

  const providerIcon = (
    <ProviderIcon
      logo={providerItem.logo(theme)}
      name={getProviderItemName(providerType)}
      size="base"
      className={hasWebsite ? "group hover:cursor-pointer" : undefined}
      textClassName={hasWebsite ? "font-medium group-hover:text-link" : "font-medium"}
    />
  )

  return (
    <div className="flex items-start justify-between">
      {providerItem.website ? (
        <a
          href={providerItem.website}
          className="flex items-center gap-2"
          target="_blank"
          rel="noreferrer"
        >
          {providerIcon}
        </a>
      ) : (
        <div className="flex items-center gap-2">{providerIcon}</div>
      )}
      <span className="text-xs text-muted-foreground">
        {i18n.t("options.apiProviders.howToConfigure")}
      </span>
    </div>
  )
}
