import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  buildShortcutHintsSettingMessage,
  shortcutHints,
  watchShortcutHintsConfig,
} from "../../src/kilo-provider/shortcut-hints-settings"

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

function stubConfig(state: Map<string, unknown>) {
  ;(vscode.workspace as unknown as Stub).getConfiguration = (section?: string) => {
    if (section !== "kilo-code.new") {
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

describe("shortcut hints settings", () => {
  let state: Map<string, unknown>

  beforeEach(() => {
    state = new Map()
    stubConfig(state)
  })

  it("defaults to enabled and reports the persisted value", () => {
    expect(shortcutHints()).toBe(true)
    expect(buildShortcutHintsSettingMessage()).toEqual({ type: "shortcutHintsSettingLoaded", visible: true })

    state.set("showShortcutHints", false)
    expect(buildShortcutHintsSettingMessage()).toEqual({ type: "shortcutHintsSettingLoaded", visible: false })
  })

  it("synchronizes open viewers and stops after disposal", () => {
    const listeners = new Set<(event: vscode.ConfigurationChangeEvent) => void>()
    const workspace = vscode.workspace as unknown as Stub
    workspace.onDidChangeConfiguration = (listener) => {
      listeners.add(listener)
      return new vscode.Disposable(() => listeners.delete(listener))
    }
    const parent: unknown[] = []
    const child: unknown[] = []
    const main = watchShortcutHintsConfig((msg) => parent.push(msg))
    const viewer = watchShortcutHintsConfig((msg) => child.push(msg))
    const emit = (key: string) => {
      for (const listener of listeners) listener({ affectsConfiguration: (name) => name === key })
    }

    emit("kilo-code.new.agentManager.autoBranchNaming")
    expect(parent).toEqual([])
    expect(child).toEqual([])

    state.set("showShortcutHints", false)
    emit("kilo-code.new.showShortcutHints")
    expect(parent).toEqual([{ type: "shortcutHintsSettingLoaded", visible: false }])
    expect(child).toEqual(parent)

    viewer.dispose()
    state.set("showShortcutHints", true)
    emit("kilo-code.new.showShortcutHints")
    expect(parent).toHaveLength(2)
    expect(child).toHaveLength(1)

    main.dispose()
    expect(listeners.size).toBe(0)
  })
})
