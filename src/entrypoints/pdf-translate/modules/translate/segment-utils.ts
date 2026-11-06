import type { DocumentUnit } from "@/modules/pdf-core/document-flow"

/** 标题和合并组按完整语义送翻；普通段落由上游独立送翻。 */
export function requestTextForUnit(unit: DocumentUnit): string {
  return unit.parts
    .map((part) => part.paragraph.text.trim())
    .filter((text) => text !== "")
    .join(" ")
}
