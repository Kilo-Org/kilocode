import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { buildIndexingSettingsMessage, validIndexingSetting } from "../../src/kilo-provider/indexing-settings"

type Stub = {
  getConfiguration: (section?: string) => {
    get: <T>(key: string, fallback?: T) => T | undefined
  }
}

const original = vscode.workspace.getConfiguration

function stubConfig(state: Map<string, unknown>) {
  ;(vscode.workspace as unknown as Stub).getConfiguration = (section?: string) => {
    if (section !== "kilo-code.new.indexing") {
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

describe("buildIndexingSettingsMessage", () => {
  let state: Map<string, unknown>

  beforeEach(() => {
    state = new Map()
    stubConfig(state)
  })

  it("shows the indexing button by default", () => {
    expect(buildIndexingSettingsMessage().settings.showButtonWhenDisabled).toBe(true)
  })

  it("returns the persisted button preference", () => {
    state.set("showButtonWhenDisabled", false)

    expect(buildIndexingSettingsMessage().settings.showButtonWhenDisabled).toBe(false)
  })
})

describe("validIndexingSetting", () => {
  it("accepts only boolean button visibility updates", () => {
    expect(validIndexingSetting("showButtonWhenDisabled", true)).toBe(true)
    expect(validIndexingSetting("showButtonWhenDisabled", false)).toBe(true)
    expect(validIndexingSetting("showButtonWhenDisabled", "false")).toBe(false)
    expect(validIndexingSetting("unknown", true)).toBe(false)
  })
})
