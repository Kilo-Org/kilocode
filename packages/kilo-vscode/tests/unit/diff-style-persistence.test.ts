import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { getUserDiffStyle, setUserDiffStyle } from "../../src/review-settings"

// Stateful configuration mock: getUserDiffStyle reads the effective value via
// `get` (workspace overrides win), setUserDiffStyle writes via `update`, so the
// test backs both with one in-memory store plus an optional workspace layer.
const store: Record<string, unknown> = {}
const original = vscode.workspace.getConfiguration

function installConfig(values: Record<string, unknown> = {}, workspace: Record<string, unknown> = {}) {
  for (const key of Object.keys(store)) delete store[key]
  Object.assign(store, values)
  ;(vscode.workspace as unknown as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration =
    () =>
      ({
        get: <T>(key: string, fallback?: T) =>
          key in workspace ? (workspace[key] as T) : key in store ? (store[key] as T) : fallback,
        inspect: (key: string) =>
          key in store || key in workspace ? { globalValue: store[key], workspaceValue: workspace[key] } : undefined,
        update: async (key: string, value: unknown) => {
          store[key] = value
        },
      }) as vscode.WorkspaceConfiguration
}

afterEach(() => {
  ;(vscode.workspace as unknown as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration =
    original
})

describe("diff style persistence", () => {
  test("getUserDiffStyle is undefined before any toggle", () => {
    installConfig()
    expect(getUserDiffStyle()).toBeUndefined()
  })

  test("setUserDiffStyle round-trips through global configuration", async () => {
    installConfig()
    await setUserDiffStyle("split")
    expect(getUserDiffStyle()).toBe("split")
    await setUserDiffStyle("unified")
    expect(getUserDiffStyle()).toBe("unified")
  })

  test("getUserDiffStyle ignores invalid stored values", () => {
    installConfig({ "diff.style": "side-by-side" })
    expect(getUserDiffStyle()).toBeUndefined()
  })

  test("getUserDiffStyle reads the effective value, so workspace overrides win", () => {
    // Global split, workspace-local unified: the scope-aware read must let the
    // workspace override win, matching how the other Kilo settings are read.
    installConfig({ "diff.style": "split" }, { "diff.style": "unified" })
    expect(getUserDiffStyle()).toBe("unified")
  })
})
