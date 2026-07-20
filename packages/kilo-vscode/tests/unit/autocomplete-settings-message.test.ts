import { describe, it, expect, afterEach, beforeEach } from "bun:test"
import * as vscode from "vscode"
import { buildAutocompleteSettingsMessage, validAutocompleteSetting } from "../../src/services/autocomplete/settings"

type Stub = {
  getConfiguration: (section?: string) => {
    get: <T>(key: string, fallback?: T) => T | undefined
    update?: (key: string, value: unknown) => Promise<void>
  }
}

const original = vscode.workspace.getConfiguration

function stubConfig(state: Map<string, unknown>) {
  ;(vscode.workspace as unknown as Stub).getConfiguration = (section?: string) => {
    if (section !== "kilo-code.new.autocomplete") {
      return { get: <T>(_key: string, fallback?: T) => fallback }
    }
    return {
      get: <T>(key: string, fallback?: T) => (state.has(key) ? (state.get(key) as T) : fallback),
    }
  }
}

afterEach(() => {
  ;(vscode.workspace as unknown as Stub).getConfiguration = original as Stub["getConfiguration"]
})

describe("buildAutocompleteSettingsMessage", () => {
  let state: Map<string, unknown>

  beforeEach(() => {
    state = new Map()
    stubConfig(state)
  })

  it("returns null for both keys when nothing is set so the webview renders 'Not set'", () => {
    const msg = buildAutocompleteSettingsMessage()

    expect(msg.settings.provider).toBeNull()
    expect(msg.settings.model).toBeNull()
  })

  it("passes an explicit BYOK selection through verbatim", () => {
    state.set("provider", "inception")
    state.set("model", "mercury-edit-2")

    const msg = buildAutocompleteSettingsMessage()

    expect(msg.settings.provider).toBe("inception")
    expect(msg.settings.model).toBe("mercury-edit-2")
  })

  it("does not coerce a bare model setting to a default — let the webview see what was stored", () => {
    state.set("model", "mercury-edit-2")

    const msg = buildAutocompleteSettingsMessage()

    expect(msg.settings.provider).toBeNull()
    expect(msg.settings.model).toBe("mercury-edit-2")
  })
})

describe("validAutocompleteSetting", () => {
  it("accepts null/undefined for provider and model so the user can clear back to the default", () => {
    expect(validAutocompleteSetting("provider", null)).toBe(true)
    expect(validAutocompleteSetting("provider", undefined)).toBe(true)
    expect(validAutocompleteSetting("model", null)).toBe(true)
    expect(validAutocompleteSetting("model", undefined)).toBe(true)
  })

  it("accepts arbitrary configured providers and models", () => {
    expect(validAutocompleteSetting("provider", "lmstudio")).toBe(true)
    expect(validAutocompleteSetting("model", "qwen2.5-coder-1.5b")).toBe(true)
  })

  it("rejects blank providers and models", () => {
    expect(validAutocompleteSetting("provider", "")).toBe(false)
    expect(validAutocompleteSetting("model", "  ")).toBe(false)
  })

  it("rejects non-boolean toggle updates", () => {
    expect(validAutocompleteSetting("enableAutoTrigger", "true")).toBe(false)
  })
})
