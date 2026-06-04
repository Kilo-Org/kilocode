import { beforeEach, describe, expect, it, vi } from "vitest"

const state = new Map<string, unknown>()
const update = vi.fn((key: string, value: unknown) => {
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

  it("includes the configured direct provider model in loaded settings", async () => {
    state.set("provider", "inception")
    state.set("model", "mercury-edit-2")
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.provider).toBe("inception")
    expect(buildAutocompleteSettingsMessage().settings.model).toBe("mercury-edit-2")
  })

  it("passes a bare model setting through unchanged so the webview can render it as-is", async () => {
    // The webview now distinguishes "no explicit setting" (null) from "user
    // picked something." We don't try to interpret a bare `model` here —
    // resolving it to a default happens at the runtime layer, not in the
    // settings message.
    state.set("model", "mercury-edit-2")
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.provider).toBeNull()
    expect(buildAutocompleteSettingsMessage().settings.model).toBe("mercury-edit-2")
  })

  it("returns null for both keys when nothing is set (let the webview render 'Not set')", async () => {
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.provider).toBeNull()
    expect(buildAutocompleteSettingsMessage().settings.model).toBeNull()
  })

  it("preserves an unsupported stored model verbatim — runtime fallback handles resolution", async () => {
    state.set("model", "some/removed-model")
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.provider).toBeNull()
    expect(buildAutocompleteSettingsMessage().settings.model).toBe("some/removed-model")
  })

  it("validates supported model updates", async () => {
    const { validAutocompleteSetting } = await import("../settings")

    expect(validAutocompleteSetting("model", "mercury-edit-2")).toBe(true)
    expect(validAutocompleteSetting("provider", "inception")).toBe(true)
  })

  it("accepts null/undefined for provider and model so users can clear the setting", async () => {
    const { validAutocompleteSetting } = await import("../settings")

    expect(validAutocompleteSetting("provider", null)).toBe(true)
    expect(validAutocompleteSetting("provider", undefined)).toBe(true)
    expect(validAutocompleteSetting("model", null)).toBe(true)
    expect(validAutocompleteSetting("model", undefined)).toBe(true)
  })

  it("rejects unsupported autocomplete updates", async () => {
    const { validAutocompleteSetting } = await import("../settings")

    expect(validAutocompleteSetting("model", "other/model")).toBe(false)
    expect(validAutocompleteSetting("provider", "openrouter")).toBe(false)
  })

  it("rejects non-boolean toggle updates", async () => {
    const { validAutocompleteSetting } = await import("../settings")

    expect(validAutocompleteSetting("enableAutoTrigger", "true")).toBe(false)
  })
})
