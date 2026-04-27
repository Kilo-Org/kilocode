import { beforeEach, describe, expect, it, mock } from "bun:test"

const state = new Map<string, unknown>()
const update = mock(async (key: string, value: unknown) => {
  state.set(key, value)
})

// Overrides the shared vscode preload (tests/setup/vscode-mock.ts) so we can
// drive getConfiguration/update against a stateful backing store.
mock.module("vscode", () => ({
  ConfigurationTarget: {
    Global: 1,
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
      update,
    }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
  },
}))

describe("autocomplete settings", () => {
  beforeEach(() => {
    state.clear()
    update.mockClear()
  })

  it("includes the configured model in loaded settings", async () => {
    state.set("model", "inception/mercury-edit")
    const { buildAutocompleteSettingsMessage } = await import("../../src/services/autocomplete/settings")

    expect(buildAutocompleteSettingsMessage().settings.model).toBe("inception/mercury-edit")
  })

  it("persists supported model updates", async () => {
    const post = mock()
    const { routeAutocompleteMessage } = await import("../../src/services/autocomplete/settings")

    await routeAutocompleteMessage(
      { type: "updateAutocompleteSetting", key: "model", value: "inception/mercury-edit" },
      post,
    )

    expect(update).toHaveBeenCalledWith("model", "inception/mercury-edit", 1)
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "autocompleteSettingsLoaded" }))
  })

  it("rejects unsupported model updates", async () => {
    const post = mock()
    const { routeAutocompleteMessage } = await import("../../src/services/autocomplete/settings")

    await routeAutocompleteMessage({ type: "updateAutocompleteSetting", key: "model", value: "other/model" }, post)

    expect(update).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it("rejects non-boolean toggle updates", async () => {
    const post = mock()
    const { routeAutocompleteMessage } = await import("../../src/services/autocomplete/settings")

    await routeAutocompleteMessage({ type: "updateAutocompleteSetting", key: "enableAutoTrigger", value: "true" }, post)

    expect(update).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })
})
