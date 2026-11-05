import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { notebookToolsEnabled } from "../src/services/notebook/setting"

const original = vscode.workspace.getConfiguration

function configure(enabled: boolean | undefined, trusted: boolean) {
  vscode.workspace.getConfiguration = ((_section: string) =>
    ({
      get: (key: string, fallback?: unknown) => (key === "experimental.nativeNotebookTools" ? enabled : fallback),
    }) as unknown as vscode.WorkspaceConfiguration) as typeof vscode.workspace.getConfiguration
  Object.defineProperty(vscode.workspace, "isTrusted", { value: trusted, configurable: true })
}

afterEach(() => {
  vscode.workspace.getConfiguration = original
  delete (vscode.workspace as unknown as { isTrusted?: boolean }).isTrusted
})

describe("native notebook tools setting", () => {
  test("is off when the setting is absent", () => {
    configure(undefined, true)
    expect(notebookToolsEnabled()).toBe(false)
  })

  test("is off when the setting is false", () => {
    configure(false, true)
    expect(notebookToolsEnabled()).toBe(false)
  })

  test("is off in an untrusted workspace", () => {
    configure(true, false)
    expect(notebookToolsEnabled()).toBe(false)
  })

  test("is on only when the setting is true in a trusted workspace", () => {
    configure(true, true)
    expect(notebookToolsEnabled()).toBe(true)
  })
})
