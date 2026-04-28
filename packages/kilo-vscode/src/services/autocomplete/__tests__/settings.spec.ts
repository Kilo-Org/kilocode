import { beforeEach, describe, expect, it, vi } from "vitest"

const state = new Map<string, unknown>()
const update = vi.fn(async (key: string, value: unknown) => {
  state.set(key, value)
})

vi.mock("vscode", () => ({
  ConfigurationTarget: {
    Global: 1,
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, fallback: unknown) => state.get(key) ?? fallback),
      update,
    })),
    onDidChangeConfiguration: vi.fn(),
  },
}))

describe("autocomplete settings", () => {
  beforeEach(() => {
    state.clear()
    update.mockClear()
  })

  it("includes the configured model in loaded settings", async () => {
    state.set("model", "inception/mercury-edit")
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.model).toBe("inception/mercury-edit")
  })

  it("defaults to codestral when no model is set", async () => {
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.model).toBe("mistralai/codestral-2508")
  })

  it("defaults to codestral when stored model is no longer supported", async () => {
    state.set("model", "some/removed-model")
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.model).toBe("mistralai/codestral-2508")
  })

  it("persists supported model updates", async () => {
    const post = vi.fn()
    const { routeAutocompleteMessage } = await import("../settings")

    await routeAutocompleteMessage(
      { type: "updateAutocompleteSetting", key: "model", value: "inception/mercury-edit" },
      post,
    )

    expect(update).toHaveBeenCalledWith("model", "inception/mercury-edit", 1)
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "autocompleteSettingsLoaded" }))
  })

  it("rejects unsupported model updates", async () => {
    const post = vi.fn()
    const { routeAutocompleteMessage } = await import("../settings")

    await routeAutocompleteMessage({ type: "updateAutocompleteSetting", key: "model", value: "other/model" }, post)

    expect(update).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it("rejects non-boolean toggle updates", async () => {
    const post = vi.fn()
    const { routeAutocompleteMessage } = await import("../settings")

    await routeAutocompleteMessage({ type: "updateAutocompleteSetting", key: "enableAutoTrigger", value: "true" }, post)

    expect(update).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })
})
