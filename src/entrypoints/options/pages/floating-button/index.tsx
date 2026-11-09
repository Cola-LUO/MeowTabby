import { GradientBackground } from "@/components/gradient-background"
import { i18n } from "@/utils/i18n"
import { PageLayout } from "../../components/page-layout"
import { ClickActionSection } from "./click-action"
import { DisplaySection } from "./display"
import { EnableItem } from "./enable-item"
import { FloatingButtonPreview } from "./preview"

export function FloatingButtonPage() {
  return (
    <PageLayout
      title={i18n.t("options.floatingButton.title")}
      description={i18n.t("options.floatingButton.pageDescription")}
      innerClassName="flex flex-col gap-10"
    >
      <GradientBackground>
        <FloatingButtonPreview />
      </GradientBackground>
      <EnableItem />
      <DisplaySection />
      <ClickActionSection />
    </PageLayout>
  )
}
