import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { buildChatSettingsMessage, validChatSetting } from "../../src/kilo-provider/chat-settings"

type Stub = {
  getConfiguration: (section?: string) => {
    get: <T>(key: string, fallback?: T) => T | undefined
  }
}

const original = vscode.workspace.getConfiguration

function stubConfig(state: Map<string, unknown>) {
  ;(vscode.workspace as unknown as Stub).getConfiguration = (section?: string) => {
    if (section !== "kilo-code.new.chat") {
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

describe("buildChatSettingsMessage", () => {
  let state: Map<string, unknown>

  beforeEach(() => {
    state = new Map()
    stubConfig(state)
  })

  it("enables Shift+Tab variant cycling by default", () => {
    expect(buildChatSettingsMessage().settings.shiftTabCyclesVariant).toBe(true)
  })

  it("limits chat content width by default", () => {
    expect(buildChatSettingsMessage().settings.limitContentWidth).toBe(true)
  })

  it("returns the persisted cycling preference", () => {
    state.set("shiftTabCyclesVariant", false)

    expect(buildChatSettingsMessage().settings.shiftTabCyclesVariant).toBe(false)
  })

  it("returns the persisted content width preference", () => {
    state.set("limitContentWidth", false)

    expect(buildChatSettingsMessage().settings.limitContentWidth).toBe(false)
  })
})

describe("validChatSetting", () => {
  it("accepts only boolean chat setting updates", () => {
    expect(validChatSetting("shiftTabCyclesVariant", true)).toBe(true)
    expect(validChatSetting("shiftTabCyclesVariant", false)).toBe(true)
    expect(validChatSetting("shiftTabCyclesVariant", "false")).toBe(false)
    expect(validChatSetting("limitContentWidth", true)).toBe(true)
    expect(validChatSetting("limitContentWidth", false)).toBe(true)
    expect(validChatSetting("limitContentWidth", "false")).toBe(false)
    expect(validChatSetting("unknown", true)).toBe(false)
  })
})
