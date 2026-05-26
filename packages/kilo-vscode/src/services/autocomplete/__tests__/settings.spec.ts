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

  it("includes the configured local Ollama model in loaded settings", async () => {
    state.set("provider", "ollama")
    state.set("model", "qwen2.5-coder:1.5b")
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.provider).toBe("ollama")
    expect(buildAutocompleteSettingsMessage().settings.model).toBe("qwen2.5-coder:1.5b")
  })

  it("does not infer direct provider from a bare model name when provider is unset", async () => {
    // Safety: a legacy `model` setting alone must never silently route to a
    // direct BYOK provider. Direct providers require an explicit `provider`.
    state.set("model", "mercury-edit-2")
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.provider).toBe("kilo")
    expect(buildAutocompleteSettingsMessage().settings.model).toBe("mistralai/codestral-2508")
  })

  it("defaults to codestral when no model is set", async () => {
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.provider).toBe("kilo")
    expect(buildAutocompleteSettingsMessage().settings.model).toBe("mistralai/codestral-2508")
  })

  it("defaults to codestral when stored model is no longer supported", async () => {
    state.set("model", "some/removed-model")
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.provider).toBe("kilo")
    expect(buildAutocompleteSettingsMessage().settings.model).toBe("mistralai/codestral-2508")
  })

  it("maps legacy inception/mercury-edit to Kilo Gateway Mercury", async () => {
    state.set("model", "inception/mercury-edit")
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.provider).toBe("kilo")
    expect(buildAutocompleteSettingsMessage().settings.model).toBe("inception/mercury-edit-2")
  })

  it("maps legacy inception/mercury-edit-2 to Kilo Gateway Mercury", async () => {
    state.set("model", "inception/mercury-edit-2")
    const { buildAutocompleteSettingsMessage } = await import("../settings")

    expect(buildAutocompleteSettingsMessage().settings.provider).toBe("kilo")
    expect(buildAutocompleteSettingsMessage().settings.model).toBe("inception/mercury-edit-2")
  })

  it("validates supported model updates", async () => {
    const { validAutocompleteSetting } = await import("../settings")

    expect(validAutocompleteSetting("model", "mercury-edit-2")).toBe(true)
    expect(validAutocompleteSetting("provider", "inception")).toBe(true)
    expect(validAutocompleteSetting("model", "qwen2.5-coder:1.5b")).toBe(true)
    expect(validAutocompleteSetting("provider", "ollama")).toBe(true)
  })

  it("rejects unsupported autocomplete updates", async () => {
    const { validAutocompleteSetting } = await import("../settings")

    expect(validAutocompleteSetting("model", "other/model")).toBe(false)
    expect(validAutocompleteSetting("provider", undefined)).toBe(false)
    expect(validAutocompleteSetting("provider", null)).toBe(false)
  })

  it("rejects non-boolean toggle updates", async () => {
    const { validAutocompleteSetting } = await import("../settings")

    expect(validAutocompleteSetting("enableAutoTrigger", "true")).toBe(false)
  })
})
