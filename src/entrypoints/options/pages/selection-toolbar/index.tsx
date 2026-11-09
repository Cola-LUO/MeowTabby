import { RiTranslate } from "@remixicon/react"
import { IconBook2, IconVolume } from "@tabler/icons-react"
import { GradientBackground } from "@/components/gradient-background"
import { i18n } from "@/utils/i18n"
import { PageLayout } from "../../components/page-layout"
import { ActionsSection } from "./actions"
import { DisplaySection } from "./display"
import { EnableItem } from "./enable-item"

export function SelectionToolbarPage() {
  return (
    <PageLayout
      title={i18n.t("options.selectionToolbar.title")}
      description={i18n.t("options.selectionToolbar.pageDescription")}
      innerClassName="flex flex-col gap-10"
    >
      <GradientBackground>
        <div
          role="img"
          aria-label={i18n.t("options.selectionToolbar.demoImageAlt")}
          className="flex items-center rounded-sm border border-border/50 bg-popover text-popover-foreground shadow-floating"
        >
          <span className="flex h-7 items-center justify-center px-2">
            <RiTranslate aria-hidden="true" className="size-4.5" />
          </span>
          <span className="flex h-7 items-center justify-center px-2">
            <IconVolume aria-hidden="true" className="size-4.5" strokeWidth={1.6} />
          </span>
          <span className="flex h-7 items-center justify-center px-2">
            <IconBook2 aria-hidden="true" className="size-4.5" strokeWidth={1.6} />
          </span>
        </div>
      </GradientBackground>
      <EnableItem />
      <ActionsSection />
      <DisplaySection />
    </PageLayout>
  )
}
