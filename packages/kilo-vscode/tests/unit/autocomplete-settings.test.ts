import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as vscode from "vscode"

const state = new Map<string, unknown>()
const update = mock(async (key: string, value: unknown) => {
  state.set(key, value)
})

// Piggy-back on the shared vscode preload (tests/setup/vscode-mock.ts) instead of
// calling mock.module("vscode", ...) here — a whole-module override would leak
// into other test files that need the preload's richer surface.
spyOn(vscode.workspace, "getConfiguration").mockImplementation(
  () =>
    ({
      get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
      update,
    }) as unknown as vscode.WorkspaceConfiguration,
)

const { buildAutocompleteSettingsMessage, routeAutocompleteMessage } = await import(
  "../../src/services/autocomplete/settings"
)

describe("autocomplete settings", () => {
  beforeEach(() => {
    state.clear()
    update.mockClear()
  })

  it("includes the configured model in loaded settings", () => {
    state.set("model", "inception/mercury-edit")

    expect(buildAutocompleteSettingsMessage().settings.model).toBe("inception/mercury-edit")
  })

  it("persists supported model updates", async () => {
    const post = mock()

    await routeAutocompleteMessage(
      { type: "updateAutocompleteSetting", key: "model", value: "inception/mercury-edit" },
      post,
    )

    expect(update).toHaveBeenCalledWith("model", "inception/mercury-edit", vscode.ConfigurationTarget.Global)
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "autocompleteSettingsLoaded" }))
  })

  it("rejects unsupported model updates", async () => {
    const post = mock()

    await routeAutocompleteMessage({ type: "updateAutocompleteSetting", key: "model", value: "other/model" }, post)

    expect(update).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it("rejects non-boolean toggle updates", async () => {
    const post = mock()

    await routeAutocompleteMessage({ type: "updateAutocompleteSetting", key: "enableAutoTrigger", value: "true" }, post)

    expect(update).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })
})
