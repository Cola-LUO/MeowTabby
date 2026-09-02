// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { describe, expect, it } from "vitest"
import { configAtom } from "@/utils/atoms/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { BUILT_IN_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"
import { BUILT_IN_AI_PROVIDER_ID } from "@/utils/constants/provider-ids"
import { getBuiltInDictionaryAction } from "@/utils/custom-actions"
import {
  BuiltInProviderEditor,
  ProviderEditor,
  useProviderEditor,
} from "../api-providers/providers-config/provider-editor"
import {
  ActionEditor,
  BuiltInActionEditor,
  CustomActionEditor,
  useActionEditor,
} from "../custom-actions/action-config-form/action-editor"

function ActionContextProbe() {
  useActionEditor()
  return null
}

function ProviderContextProbe() {
  useProviderEditor()
  return null
}

function DeleteActionProbe() {
  const deleteAction = useActionEditor().actions.delete
  if (!deleteAction) {
    throw new Error("Expected custom action delete command")
  }

  return (
    <button type="button" onClick={() => void deleteAction()}>
      Delete action
    </button>
  )
}

function createConfigStore() {
  const store = createStore()
  store.set(configAtom, structuredClone(DEFAULT_CONFIG))
  return store
}

describe("editor compound component contexts", () => {
  it("fails fast when an ActionEditor component is outside its provider", () => {
    expect(() => render(<ActionContextProbe />)).toThrow(
      "ActionEditor components must be rendered inside an ActionEditor Provider",
    )
  })

  it("fails fast when a ProviderEditor component is outside its provider", () => {
    expect(() => render(<ProviderContextProbe />)).toThrow(
      "ProviderEditor components must be rendered inside a ProviderEditor Provider",
    )
  })

  it("fails fast when Delete is composed for a built-in action", () => {
    const store = createConfigStore()
    const action = getBuiltInDictionaryAction(store.get(configAtom).selectionToolbar)

    expect(() =>
      render(
        <Provider store={store}>
          <BuiltInActionEditor.Provider action={action}>
            <ActionEditor.DeleteButton />
          </BuiltInActionEditor.Provider>
        </Provider>,
      ),
    ).toThrow("ActionEditor.delete is unavailable in this composition")
  })

  it("fails fast when Duplicate is composed for the built-in provider", () => {
    const store = createConfigStore()

    expect(() =>
      render(
        <Provider store={store}>
          <BuiltInProviderEditor.Provider providerId={BUILT_IN_AI_PROVIDER_ID}>
            <ProviderEditor.DuplicateButton />
          </BuiltInProviderEditor.Provider>
        </Provider>,
      ),
    ).toThrow("ProviderEditor.duplicate is unavailable in this composition")
  })

  it("resets Note suggestions to Dictionary when deleting its selected custom action", async () => {
    const store = createConfigStore()
    const config = structuredClone(store.get(configAtom))
    const action = {
      id: "note-suggestion-action",
      name: "Note suggestion Action",
      enabled: false,
      icon: "tabler:sparkles",
      providerId: config.selectionToolbar.builtInActions.dictionary.providerId,
      systemPrompt: "System prompt",
      prompt: "Prompt",
      outputSchema: [
        {
          id: "result",
          name: "result",
          type: "string" as const,
          description: "Result",
          speaking: false,
        },
      ],
    }
    config.selectionToolbar.customActions = [action]
    config.selectionToolbar.noteSuggestion.actionId = action.id
    store.set(configAtom, config)

    render(
      <Provider store={store}>
        <CustomActionEditor.Provider action={action}>
          <DeleteActionProbe />
        </CustomActionEditor.Provider>
      </Provider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Delete action" }))

    await waitFor(() => {
      const selectionToolbar = store.get(configAtom).selectionToolbar
      expect(selectionToolbar.customActions).toEqual([])
      expect(selectionToolbar.noteSuggestion.actionId).toBe(BUILT_IN_DICTIONARY_ACTION_ID)
    })
  })
})
