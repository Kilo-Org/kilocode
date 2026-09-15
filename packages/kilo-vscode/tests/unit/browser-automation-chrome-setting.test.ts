import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { integratedBrowserUseSystemChrome } from "../../src/services/browser-automation/chrome-setting"

describe("Integrated Browser Chrome preference", () => {
  const descriptors = Object.getOwnPropertyDescriptors(vscode.workspace)

  function config(next: { chosen?: boolean; legacy?: boolean }) {
    vscode.workspace.getConfiguration = ((section: string) =>
      ({
        get: (_key: string, fallback?: unknown) =>
          section === "kilo-code.new.browserAutomation" ? (next.legacy ?? fallback) : fallback,
        inspect: () => (section === "kilo-code.new.agentManager.browser" ? { globalValue: next.chosen } : {}),
        update: async () => {},
      }) as unknown as vscode.WorkspaceConfiguration) as typeof vscode.workspace.getConfiguration
  }

  afterEach(() => {
    Object.defineProperties(vscode.workspace, descriptors)
  })

  test("prefers an explicit value on the current key", () => {
    config({ chosen: false, legacy: true })
    expect(integratedBrowserUseSystemChrome()).toBe(false)
  })

  test("falls back to the previous key when the current key is unset", () => {
    config({ legacy: false })
    expect(integratedBrowserUseSystemChrome()).toBe(false)
  })

  test("defaults to system Chrome when neither key is set", () => {
    config({})
    expect(integratedBrowserUseSystemChrome()).toBe(true)
  })
})
