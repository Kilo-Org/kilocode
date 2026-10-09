import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import {
  integratedBrowserFallback,
  integratedBrowserUseSystemChrome,
  migrateIntegratedBrowserUseSystemChrome,
} from "../../src/services/browser-automation/chrome-setting"

const INTEGRATED_BROWSER = "kilo-code.new.agentManager.browser"

describe("Integrated Browser Chrome preference", () => {
  const descriptors = Object.getOwnPropertyDescriptors(vscode.workspace)
  let writes: Array<{ key: string; value: unknown; target: unknown }> = []

  function config(input: { current?: boolean; previous?: boolean; previousWorkspace?: boolean }) {
    writes = []
    vscode.workspace.getConfiguration = ((section: string) =>
      ({
        get: (_key: string, fallback?: unknown) =>
          section === INTEGRATED_BROWSER ? (input.current ?? fallback) : fallback,
        inspect: () =>
          section === INTEGRATED_BROWSER
            ? { globalValue: input.current }
            : { globalValue: input.previous, workspaceValue: input.previousWorkspace },
        update: async (key: string, value: unknown, target: unknown) => {
          writes.push({ key, value, target })
        },
      }) as unknown as vscode.WorkspaceConfiguration) as typeof vscode.workspace.getConfiguration
  }

  afterEach(() => {
    Object.defineProperties(vscode.workspace, descriptors)
  })

  test("reads the preference from the Integrated Browser key", () => {
    config({ current: false, previous: true })
    expect(integratedBrowserUseSystemChrome()).toBe(false)
  })

  test("defaults to system Chrome when the key is unset", () => {
    config({})
    expect(integratedBrowserUseSystemChrome()).toBe(true)
  })

  test("allows fallback only in WSL without an explicit preference", () => {
    config({})
    expect(integratedBrowserFallback("wsl")).toBe(true)
    expect(integratedBrowserFallback("ssh-remote")).toBe(false)
    expect(integratedBrowserFallback("dev-container")).toBe(false)
    expect(integratedBrowserFallback("local")).toBe(false)
    for (const current of [true, false]) {
      config({ current })
      expect(integratedBrowserFallback("wsl")).toBe(false)
    }
    expect(writes).toEqual([])
  })

  test("copies a legacy preference once when the key is unset", async () => {
    config({ previous: false })
    await migrateIntegratedBrowserUseSystemChrome()
    expect(writes).toEqual([{ key: "useSystemChrome", value: false, target: vscode.ConfigurationTarget.Global }])
  })

  test("keeps an existing Integrated Browser preference", async () => {
    config({ current: true, previous: false })
    await migrateIntegratedBrowserUseSystemChrome()
    expect(writes).toEqual([])
  })

  test("does not write when no legacy preference exists", async () => {
    config({})
    await migrateIntegratedBrowserUseSystemChrome()
    expect(writes).toEqual([])
  })

  test("does not promote a workspace-scoped legacy preference", async () => {
    config({ previousWorkspace: false })
    await migrateIntegratedBrowserUseSystemChrome()
    expect(writes).toEqual([])
  })
})
