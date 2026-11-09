import { GradientBackground } from "@/components/gradient-background"
import { i18n } from "@/utils/i18n"
import { PageLayout } from "../../components/page-layout"
import { EnableItem } from "./enable-item"
import { ContextMenuPreview } from "./preview"

export function ContextMenuPage() {
  return (
    <PageLayout
      title={i18n.t("options.contextMenu.title")}
      description={i18n.t("options.contextMenu.pageDescription")}
      innerClassName="flex flex-col gap-10"
    >
      <GradientBackground>
        <ContextMenuPreview />
      </GradientBackground>
      <EnableItem />
    </PageLayout>
  )
}
