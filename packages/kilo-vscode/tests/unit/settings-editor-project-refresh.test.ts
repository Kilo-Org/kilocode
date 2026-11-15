import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { refreshPanelProjectDirectory, resolvePanelProjectDirectory } from "../../src/project-directory"

const SETTINGS = fs.readFileSync(path.resolve(import.meta.dir, "../../src/SettingsEditorProvider.ts"), "utf-8")

describe("settings panel project directory refresh (#16179)", () => {
  it("a panel restored with no workspace folders resolves null", () => {
    expect(resolvePanelProjectDirectory(undefined, undefined)).toBeNull()
    expect(resolvePanelProjectDirectory(undefined, [])).toBeNull()
  })

  it("adopts the single workspace folder once it becomes available", () => {
    const resolved = resolvePanelProjectDirectory(undefined, [{ uri: { fsPath: "/repo" } }])
    expect(refreshPanelProjectDirectory(resolved)).toBe("/repo")
  })

  it("never downgrades to null for an ambiguous multi-root workspace", () => {
    const resolved = resolvePanelProjectDirectory(undefined, [{ uri: { fsPath: "/a" } }, { uri: { fsPath: "/b" } }])
    expect(refreshPanelProjectDirectory(resolved)).toBeUndefined()
  })

  it("SettingsEditorProvider re-resolves on webviewReady and workspace folder changes", () => {
    const ready = SETTINGS.indexOf('msg.type === "webviewReady"')
    expect(ready).toBeGreaterThan(-1)
    expect(SETTINGS.slice(ready, ready + 120)).toContain("this.refreshProjectDirectory(view)")
    expect(SETTINGS).toContain("vscode.workspace.onDidChangeWorkspaceFolders(() => this.refreshProjectDirectory(view))")
    expect(SETTINGS).toContain("foldersDisposable.dispose()")
  })
})
