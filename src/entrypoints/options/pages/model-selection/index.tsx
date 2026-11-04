import { i18n } from "@/utils/i18n"
import { PageLayout } from "../../components/page-layout"
import { AIContentAwareConfig } from "./ai-content-aware"
import { FeatureProvidersConfig } from "./feature-providers"
import { LanguageDetectionConfig } from "./language-detection"

export function ModelSelectionPage() {
  return (
    <PageLayout
      title={i18n.t("options.modelSelection.title")}
      description={i18n.t("options.modelSelection.pageDescription")}
      innerClassName="flex flex-col gap-10"
    >
      <FeatureProvidersConfig />
      <LanguageDetectionConfig />
      <AIContentAwareConfig />
    </PageLayout>
  )
}
