// The New Worktree dialog's model memory: a pick there is the last pick of a new session, so the next dialog and the
// composer start on it (v1 `apply` pushed every explicit pick to the recents).
//
// `bun test` resolves solid-js to its server build, so memos evaluate once: a case that changes model() cannot assert
// the new value, but the callback payloads it passes (what the dialog remembers) are plain signals and reads.
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
  createDialogPreferences,
  DEFAULT_VARIANT,
  type ModelSelection,
} from "../webview-ui/agent-manager/new-worktree-models"

const catalog = ["kilo/auto", "kilo/a", "x/b"]
const valid = (model: ModelSelection) => catalog.includes(`${model.providerID}/${model.modelID}`)

function dialog(input: { saved?: ModelSelection; agent?: string; ready?: boolean; fallback?: ModelSelection } = {}) {
  const remembered: Array<{ agent: string; model: ModelSelection; variant: string | undefined }> = []
  const preferences = createRoot((dispose) => ({
    ...createDialogPreferences({
      saved: { model: input.saved },
      agent: input.agent ?? "code",
      fallback: () => input.fallback ?? { providerID: "kilo", modelID: "auto" },
      effort: () => undefined,
      ready: () => input.ready ?? true,
      valid,
      variants: (model) => (model.modelID === "b" ? ["low", "high"] : ["low"]),
      remember: (agent, model, variant) => remembered.push({ agent, model, variant }),
    }),
    dispose,
  }))
  return { preferences, remembered }
}

describe("createDialogPreferences", () => {
  test("starts on the fallback and keeps a saved choice", () => {
    const fallback = dialog()
    expect(fallback.preferences.model()).toEqual({ providerID: "kilo", modelID: "auto" })
    fallback.preferences.dispose()

    const saved = dialog({ saved: { providerID: "x", modelID: "b" } })
    expect(saved.preferences.model()).toEqual({ providerID: "x", modelID: "b" })
    saved.preferences.dispose()
  })

  test("a Kilo choice waits for the account", () => {
    const pending = dialog({
      saved: { providerID: "kilo", modelID: "a" },
      fallback: { providerID: "x", modelID: "b" },
      ready: false,
    })
    expect(pending.preferences.model()).toEqual({ providerID: "x", modelID: "b" })
    pending.preferences.dispose()
  })

  test("records the pick for the next new session", () => {
    const { preferences, remembered } = dialog()
    preferences.selectModel("x", "b")
    expect(remembered).toEqual([{ agent: "code", model: { providerID: "x", modelID: "b" }, variant: undefined }])
    expect(preferences.selection.choice()).toEqual({ providerID: "x", modelID: "b" })
    preferences.dispose()
  })

  test("carries the chosen effort onto the next pick", () => {
    const { preferences, remembered } = dialog({ saved: { providerID: "x", modelID: "b" } })
    preferences.selectVariant("high")
    preferences.selectModel("kilo", "a")
    expect(remembered.at(-1)).toEqual({ agent: "code", model: { providerID: "kilo", modelID: "a" }, variant: "low" })
    preferences.dispose()
  })

  test("records an explicit Default as no effort", () => {
    const { preferences, remembered } = dialog({ saved: { providerID: "x", modelID: "b" } })
    preferences.selectVariant(DEFAULT_VARIANT)
    expect(remembered).toEqual([{ agent: "code", model: { providerID: "x", modelID: "b" }, variant: undefined }])
    expect(preferences.variant()).toBe(DEFAULT_VARIANT)
    preferences.dispose()
  })
})
