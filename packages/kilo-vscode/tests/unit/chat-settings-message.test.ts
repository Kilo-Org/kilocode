import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  buildChatSettingsMessage,
  buildTimelineSettingMessage,
  validChatSetting,
  watchChatConfig,
} from "../../src/kilo-provider/chat-settings"

type Stub = {
  getConfiguration: (section?: string) => {
    get: <T>(key: string, fallback?: T) => T | undefined
  }
  onDidChangeConfiguration: (listener: (event: vscode.ConfigurationChangeEvent) => void) => vscode.Disposable
}

const original = {
  get: vscode.workspace.getConfiguration,
  watch: vscode.workspace.onDidChangeConfiguration,
}

function stubConfig(state: Map<string, unknown>, scope = "kilo-code.new.chat") {
  ;(vscode.workspace as unknown as Stub).getConfiguration = (section?: string) => {
    if (section !== scope) {
      return { get: <T>(_key: string, fallback?: T) => fallback }
    }
    return {
      get: <T>(key: string, fallback?: T) => (state.has(key) ? (state.get(key) as T) : fallback),
    }
  }
}

afterEach(() => {
  const workspace = vscode.workspace as unknown as Stub
  workspace.getConfiguration = original.get as Stub["getConfiguration"]
  workspace.onDidChangeConfiguration = original.watch
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

  it("returns the persisted cycling preference", () => {
    state.set("shiftTabCyclesVariant", false)

    expect(buildChatSettingsMessage().settings.shiftTabCyclesVariant).toBe(false)
  })
})

describe("timeline settings", () => {
  it.each([undefined, false, true])("returns the saved visibility %s", (visible) => {
    const state = new Map<string, unknown>()
    if (visible !== undefined) state.set("showTaskTimeline", visible)
    stubConfig(state, "kilo-code.new")

    expect(buildTimelineSettingMessage()).toEqual({
      type: "timelineSettingLoaded",
      visible: visible ?? true,
    })
  })

  it("synchronizes open viewers and stops sending after disposal", () => {
    const state = new Map<string, unknown>()
    stubConfig(state, "kilo-code.new")
    const listeners = new Set<(event: vscode.ConfigurationChangeEvent) => void>()
    const workspace = vscode.workspace as unknown as Stub
    workspace.onDidChangeConfiguration = (listener) => {
      listeners.add(listener)
      return new vscode.Disposable(() => listeners.delete(listener))
    }
    const emit = (key: string) => {
      for (const listener of listeners) listener({ affectsConfiguration: (name) => name === key })
    }
    const parent: unknown[] = []
    const child: unknown[] = []
    const main = watchChatConfig((msg) => parent.push(msg))
    const viewer = watchChatConfig((msg) => child.push(msg))

    emit("kilo-code.new.showTokenThroughput")
    expect(parent).toEqual([])
    expect(child).toEqual([])

    state.set("showTaskTimeline", false)
    emit("kilo-code.new.showTaskTimeline")
    expect(parent).toEqual([{ type: "timelineSettingLoaded", visible: false }])
    expect(child).toEqual(parent)

    state.set("showTaskTimeline", true)
    emit("kilo-code.new.showTaskTimeline")
    expect(parent.at(-1)).toEqual({ type: "timelineSettingLoaded", visible: true })
    expect(child).toEqual(parent)

    viewer.dispose()
    state.set("showTaskTimeline", false)
    emit("kilo-code.new.showTaskTimeline")
    expect(parent).toHaveLength(3)
    expect(child).toHaveLength(2)
    main.dispose()
    expect(listeners.size).toBe(0)
  })
})

describe("validChatSetting", () => {
  it("accepts only boolean cycling updates", () => {
    expect(validChatSetting("shiftTabCyclesVariant", true)).toBe(true)
    expect(validChatSetting("shiftTabCyclesVariant", false)).toBe(true)
    expect(validChatSetting("shiftTabCyclesVariant", "false")).toBe(false)
    expect(validChatSetting("unknown", true)).toBe(false)
  })
})
