import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import {
  duplicateSelectionToolbarAction,
  getBuiltInDictionaryAction,
  getSelectionToolbarActions,
  replaceSelectionToolbarAction,
} from "@/utils/custom-actions"

function cloneSelectionToolbar() {
  return structuredClone(DEFAULT_CONFIG.selectionToolbar)
}

describe("selection toolbar built-in actions", () => {
  it("always resolves Dictionary before custom actions", () => {
    const selectionToolbar = cloneSelectionToolbar()
    const dictionary = getBuiltInDictionaryAction(selectionToolbar)
    selectionToolbar.customActions = [
      {
        ...dictionary,
        id: "custom-action",
        name: "Custom",
      },
    ]

    expect(getSelectionToolbarActions(selectionToolbar).map((action) => action.id)).toEqual([
      "default-dictionary",
      "custom-action",
    ])
  })

  it("persists only mutable state when replacing the built-in Dictionary", () => {
    const selectionToolbar = cloneSelectionToolbar()
    const dictionary = getBuiltInDictionaryAction(selectionToolbar)

    const next = replaceSelectionToolbarAction(selectionToolbar, {
      ...dictionary,
      name: "Attempted rename",
      prompt: "Attempted prompt edit",
      enabled: false,
      providerId: "openai-default",
    })

    expect(next.builtInActions.dictionary).toEqual({
      enabled: false,
      providerId: "openai-default",
    })
    expect(getBuiltInDictionaryAction(next)).toMatchObject({
      id: "default-dictionary",
      name: dictionary.name,
      prompt: dictionary.prompt,
      enabled: false,
      providerId: "openai-default",
    })
    expect(next.customActions).toEqual([])
  })

  it("deep-copies enabled and provider into an editable action", () => {
    const selectionToolbar = cloneSelectionToolbar()
    selectionToolbar.builtInActions.dictionary = {
      enabled: false,
      providerId: "openai-default",
    }
    const dictionary = getBuiltInDictionaryAction(selectionToolbar)
    const duplicate = duplicateSelectionToolbarAction(dictionary, [
      dictionary,
      { ...dictionary, id: "same-name", name: dictionary.name },
    ])

    expect(duplicate).toEqual({
      ...dictionary,
      id: expect.any(String),
      name: `${dictionary.name} 1`,
    })
    expect(duplicate.id).not.toBe(dictionary.id)
  })
})
