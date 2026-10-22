import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { buildThroughputSettingMessage } from "../../src/kilo-provider/throughput-settings"

type Stub = {
  getConfiguration: (section?: string) => {
    get: <T>(key: string, fallback?: T) => T | undefined
  }
}

const original = vscode.workspace.getConfiguration

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
  ;(vscode.workspace as unknown as Stub).getConfiguration = original as Stub["getConfiguration"]
})

describe("buildThroughputSettingMessage", () => {
  let state: Map<string, unknown>

  beforeEach(() => {
    state = new Map()
    stubConfig(state)
  })

  it("shows throughput by default", () => {
    expect(buildThroughputSettingMessage().visible).toBe(true)
  })

  it("returns the persisted visibility preference", () => {
    state.set("showTokenThroughput", false)

    expect(buildThroughputSettingMessage().visible).toBe(false)
  })
})
