// The New Worktree dialog's model memory: a pick there is the last pick of a new session, so the next dialog and the
// composer start on it (v1 `apply` pushed every explicit pick to the recents). An effort change only remembers the
// effort, so it cannot rewrite the recents with a model the user never picked.
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

type Remembered = { agent: string; model: ModelSelection; variant: string | undefined }

function dialog(input: { saved?: ModelSelection; agent?: string; ready?: boolean; fallback?: ModelSelection } = {}) {
  const picks: Remembered[] = []
  const efforts: Remembered[] = []
  const preferences = createRoot((dispose) => ({
    ...createDialogPreferences({
      saved: { model: input.saved },
      agent: input.agent ?? "code",
      fallback: () => input.fallback ?? { providerID: "kilo", modelID: "auto" },
      effort: () => undefined,
      ready: () => input.ready ?? true,
      valid,
      variants: (model) => (model.modelID === "b" ? ["low", "high"] : ["low"]),
      rememberPick: (agent, model, variant) => picks.push({ agent, model, variant }),
      rememberEffort: (agent, model, variant) => efforts.push({ agent, model, variant }),
    }),
    dispose,
  }))
  return { preferences, picks, efforts }
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

  test("a saved Kilo choice waits for the account", () => {
    const pending = dialog({
      saved: { providerID: "kilo", modelID: "a" },
      fallback: { providerID: "x", modelID: "b" },
      ready: false,
    })
    expect(pending.preferences.model()).toEqual({ providerID: "x", modelID: "b" })
    pending.preferences.dispose()
  })

  test("a Kilo fallback stays usable while the account is unknown, so the dialog can still submit", () => {
    // The account read can fail for good. The resolver already applied the account rule, so a Kilo server default
    // must not be rejected again by this gate.
    const unknownAccount = dialog({ ready: false })
    expect(unknownAccount.preferences.model()).toEqual({ providerID: "kilo", modelID: "auto" })
    unknownAccount.preferences.dispose()
  })

  test("a Kilo allocation submits while the account is unknown", () => {
    // An allocation is a fresh pick from this connection's catalog, so the account read does not gate it. Otherwise
    // Compare models would stay unsubmittable forever when the account read fails.
    const { preferences } = dialog({ ready: false })
    const allocations = new Map([["kilo/a", { providerID: "kilo", modelID: "a", name: "Kilo A", count: 1 }]])
    expect(preferences.selection.canSubmit(allocations)).toBe(true)
    preferences.dispose()
  })

  test("an allocation outside the catalog is rejected", () => {
    const { preferences } = dialog()
    const allocations = new Map([["gone/m", { providerID: "gone", modelID: "m", name: "Gone", count: 1 }]])
    expect(preferences.selection.canSubmit(allocations)).toBe(false)
    preferences.dispose()
  })

  test("records the pick for the next new session", () => {
    const { preferences, picks, efforts } = dialog()
    preferences.selectModel("x", "b")
    expect(picks).toEqual([{ agent: "code", model: { providerID: "x", modelID: "b" }, variant: undefined }])
    expect(efforts).toEqual([])
    expect(preferences.selection.choice()).toEqual({ providerID: "x", modelID: "b" })
    preferences.dispose()
  })

  test("an effort change remembers the effort and leaves the pick alone", () => {
    const { preferences, picks, efforts } = dialog({ saved: { providerID: "x", modelID: "b" } })
    preferences.selectVariant("high")
    expect(efforts).toEqual([{ agent: "code", model: { providerID: "x", modelID: "b" }, variant: "high" }])
    expect(picks).toEqual([])
    preferences.dispose()
  })

  test("carries the chosen effort onto the next pick", () => {
    const { preferences, picks, efforts } = dialog({ saved: { providerID: "x", modelID: "b" } })
    preferences.selectVariant("high")
    preferences.selectModel("kilo", "a")
    expect(picks.at(-1)).toEqual({ agent: "code", model: { providerID: "kilo", modelID: "a" }, variant: "low" })
    expect(efforts).toHaveLength(1)
    preferences.dispose()
  })

  test("records an explicit Default as no effort", () => {
    const { preferences, picks, efforts } = dialog({ saved: { providerID: "x", modelID: "b" } })
    preferences.selectVariant(DEFAULT_VARIANT)
    expect(efforts).toEqual([{ agent: "code", model: { providerID: "x", modelID: "b" }, variant: undefined }])
    expect(picks).toEqual([])
    expect(preferences.variant()).toBe(DEFAULT_VARIANT)
    preferences.dispose()
  })
})
