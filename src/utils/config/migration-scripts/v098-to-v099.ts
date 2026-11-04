/**
 * Migration script from v098 to v099.
 *
 * Removes the Notebase feature: `selectionToolbar.noteSuggestion` and the
 * `notebaseConnection` field on both built-in Dictionary state and every
 * custom action. The feature is being retired, so the persisted state has no
 * replacement — the keys are simply deleted.
 *
 * IMPORTANT: This is a frozen snapshot. All values and helpers are deliberately inline and it
 * imports nothing from the evolving application code.
 */

function isObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function stripNotebaseConnection(value: any) {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    value.forEach(stripNotebaseConnection)
    return
  }
  for (const key of Object.keys(value)) {
    if (key === "notebaseConnection") {
      delete value[key]
    } else {
      stripNotebaseConnection(value[key])
    }
  }
}

export function migrate(oldConfig: any): any {
  if (!isObject(oldConfig)) return oldConfig

  const config = structuredClone(oldConfig)

  const selectionToolbar = config.selectionToolbar
  if (isObject(selectionToolbar)) {
    delete selectionToolbar.noteSuggestion
  }
  stripNotebaseConnection(selectionToolbar)

  return config
}
