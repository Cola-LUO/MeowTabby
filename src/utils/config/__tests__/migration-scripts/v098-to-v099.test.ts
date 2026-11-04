import { describe, expect, it } from "vitest"
import { migrate } from "../../migration-scripts/v098-to-v099"

function configWithNotebaseEverywhere() {
  return {
    selectionToolbar: {
      noteSuggestion: { enabled: true, actionId: "default-dictionary", providerId: "openai" },
      builtInActions: {
        dictionary: { enabled: true, providerId: "openai", notebaseConnection: { mappings: [] } },
      },
      customActions: [
        {
          id: "a",
          providerId: "openai",
          notebaseConnection: { notebaseId: "n1", mappings: [] },
        },
        { id: "b", providerId: "openai" },
      ],
      other: { notebaseConnection: { stale: true } },
    },
    pageTranslation: { providerId: "google" },
  }
}

describe("v098 to v099 migration", () => {
  it("removes selectionToolbar.noteSuggestion", () => {
    const migrated = migrate(configWithNotebaseEverywhere())
    expect(migrated.selectionToolbar.noteSuggestion).toBeUndefined()
  })

  it("removes notebaseConnection from dictionary state, custom actions and nested objects", () => {
    const migrated = migrate(configWithNotebaseEverywhere())
    expect(migrated.selectionToolbar.builtInActions.dictionary.notebaseConnection).toBeUndefined()
    expect(migrated.selectionToolbar.customActions[0].notebaseConnection).toBeUndefined()
    expect(migrated.selectionToolbar.customActions[1].notebaseConnection).toBeUndefined()
    expect(migrated.selectionToolbar.other.notebaseConnection).toBeUndefined()
  })

  it("keeps everything else untouched and does not mutate the input", () => {
    const original = configWithNotebaseEverywhere()
    const migrated = migrate(original)
    expect(original.selectionToolbar.noteSuggestion).toBeDefined()
    expect(migrated.pageTranslation).toEqual({ providerId: "google" })
    expect(migrated.selectionToolbar.builtInActions.dictionary.enabled).toBe(true)
    expect(migrated.selectionToolbar.customActions[0].id).toBe("a")
  })

  it("passes through non-object configs", () => {
    expect(migrate(null)).toBeNull()
  })
})
