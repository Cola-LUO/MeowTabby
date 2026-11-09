import meowLogo from "@/assets/icons/meowtabby.png?url&no-inline"
import { i18n } from "@/utils/i18n"

export function ContextMenuPreview() {
  const items = [
    i18n.t("contextMenu.translate"),
    i18n.t("contextMenu.translateSelection").replace("%s", "Hello"),
    i18n.t("contextMenu.readAloudSelection").replace("%s", "Hello"),
    i18n.t("options.selectionToolbar.customActions.templates.dictionary.name"),
  ]

  return (
    <div
      role="img"
      aria-label={i18n.t("options.contextMenu.demoImageAlt")}
      className="max-w-full min-w-56 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      {items.map((label) => (
        <div key={label} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
          <img src={meowLogo} alt="" className="size-4 shrink-0 rounded-full" />
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}
