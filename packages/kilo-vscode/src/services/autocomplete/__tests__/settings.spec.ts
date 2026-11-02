import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { AUTOCOMPLETE_SECTION, readAutocompleteSettings, validAutocompleteSetting } from "../settings"

type StubConfig = {
  get: <T>(key: string, fallback?: T) => T | undefined
  update: (key: string, value: unknown) => Promise<void>
}

type Stub = {
  getConfiguration: (section?: string) => StubConfig
}

const state = new Map<string, unknown>()

const original = vscode.workspace.getConfiguration

function stubConfig() {
  ;(vscode.workspace as unknown as Stub).getConfiguration = (section?: string) => {
    if (section !== AUTOCOMPLETE_SECTION) return { get: <T>(_key: string, fallback?: T) => fallback, update: async () => {} }
    return {
      get: <T>(key: string, fallback?: T) => (state.has(key) ? (state.get(key) as T) : fallback),
      update: async (key: string, value: unknown) => {
        state.set(key, value)
      },
    }
  }
}

describe("autocomplete settings", () => {
  beforeEach(() => {
    state.clear()
    stubConfig()
  })

  afterEach(() => {
    ;(vscode.workspace as unknown as Stub).getConfiguration = original as unknown as Stub["getConfiguration"]
  })

  it("includes the configured direct provider model in loaded settings", () => {
    state.set("provider", "inception")
    state.set("model", "mercury-edit-2")

    expect(readAutocompleteSettings().provider).toBe("inception")
    expect(readAutocompleteSettings().model).toBe("mercury-edit-2")
  })

  it("passes a bare model setting through unchanged so the webview can render it as-is", () => {
    // The webview distinguishes "no explicit setting" (null) from "user picked something." We don't
    // try to interpret a bare `model` here: resolving it to a default happens at the runtime layer,
    // not in the settings reader.
    state.set("model", "mercury-edit-2")

    expect(readAutocompleteSettings().provider).toBeNull()
    expect(readAutocompleteSettings().model).toBe("mercury-edit-2")
  })

  it("returns null for both keys when nothing is set (let the webview render 'Not set')", () => {
    expect(readAutocompleteSettings().provider).toBeNull()
    expect(readAutocompleteSettings().model).toBeNull()
  })

  it("preserves an unsupported stored model verbatim — runtime fallback handles resolution", () => {
    state.set("model", "some/removed-model")

    expect(readAutocompleteSettings().provider).toBeNull()
    expect(readAutocompleteSettings().model).toBe("some/removed-model")
  })

  it("validates supported model updates", () => {
    expect(validAutocompleteSetting("model", "mercury-edit-2")).toBe(true)
    expect(validAutocompleteSetting("provider", "inception")).toBe(true)
  })

  it("accepts null/undefined for provider and model so users can clear the setting", () => {
    expect(validAutocompleteSetting("provider", null)).toBe(true)
    expect(validAutocompleteSetting("provider", undefined)).toBe(true)
    expect(validAutocompleteSetting("model", null)).toBe(true)
    expect(validAutocompleteSetting("model", undefined)).toBe(true)
  })

  it("rejects unsupported autocomplete updates", () => {
    expect(validAutocompleteSetting("model", "other/model")).toBe(false)
    expect(validAutocompleteSetting("provider", "openrouter")).toBe(false)
  })

  it("rejects non-boolean toggle updates", () => {
    expect(validAutocompleteSetting("enableAutoTrigger", "true")).toBe(false)
  })
})
