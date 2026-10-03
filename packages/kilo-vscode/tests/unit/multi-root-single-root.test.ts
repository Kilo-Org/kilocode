/**
 * Single-root guard: the multi-root workspace support must not change what a
 * window with one workspace folder does. Each case pins the pre-existing
 * single-root behaviour of code the multi-root work touched.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import * as path from "path"
import { FileIgnoreController } from "../../src/services/autocomplete/shims/FileIgnoreController"
import { WorkspaceIgnoreController } from "../../src/services/autocomplete/shims/WorkspaceIgnoreController"
import { createTerminalHost } from "../../src/agent-manager/terminal-host"
import { handleEditorAction } from "../../src/kilo-provider/editor-actions"
import { codePath } from "../../src/services/code-actions/editor-utils"

const { KiloProvider } = await import("../../src/KiloProvider")

type Mutable = Record<string, unknown>
const workspace = vscode.workspace as unknown as Mutable & { fs: Mutable }
const window = vscode.window as unknown as Mutable
const saved = {
  folders: workspace.workspaceFolders,
  stat: workspace.fs.stat,
  find: workspace.findFiles,
  warn: window.showWarningMessage,
  visible: window.visibleTextEditors,
  active: window.activeTextEditor,
  tabs: window.tabGroups,
}

let root = ""
let repo = ""
let other = ""

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kilo-single-"))
  repo = path.join(root, "repo")
  other = path.join(root, "other")
  mkdirSync(path.join(repo, "src"), { recursive: true })
  mkdirSync(path.join(other, "src"), { recursive: true })
  writeFileSync(path.join(repo, "src", "a.ts"), "")
  writeFileSync(path.join(other, "src", "b.ts"), "")
  workspace.workspaceFolders = [{ uri: { fsPath: repo, scheme: "file", path: repo }, name: "repo" }]
})

afterEach(() => {
  workspace.workspaceFolders = saved.folders
  workspace.fs.stat = saved.stat
  workspace.findFiles = saved.find
  window.showWarningMessage = saved.warn
  window.visibleTextEditors = saved.visible
  window.activeTextEditor = saved.active
  window.tabGroups = saved.tabs
  rmSync(root, { recursive: true, force: true })
})

function provider(opts: Record<string, unknown> = {}) {
  const messages: Array<{ type?: string }> = []
  const instance = new KiloProvider({} as never, { getClient: () => undefined } as never, undefined, opts as never)
  const internal = instance as unknown as {
    postMessage: (message: unknown) => void
    announceFolder: (quiet?: boolean) => void
    getRootDirectory: () => string
    handleFolderMessage: (message: { type: string; directory?: unknown }) => void
    getSessionRefreshContext: (revision: number) => { workspaceFolders?: () => string[] }
    gatherEditorContext: (dir?: string) => Promise<Record<string, unknown>>
  }
  internal.postMessage = (message) => messages.push(message as { type?: string })
  return { internal, messages }
}

describe("single-root windows", () => {
  it("never show a folder picker or announce folders", () => {
    const sidebar = provider()
    const settings = provider({ projectDirectory: repo })

    sidebar.internal.announceFolder(true)
    sidebar.internal.announceFolder()
    settings.internal.announceFolder()

    expect(sidebar.messages).toEqual([])
    expect(settings.messages).toEqual([])
  })

  it("keep the first folder as the root and list no extra history folders", () => {
    const { internal } = provider()

    internal.handleFolderMessage({ type: "selectWorkspaceFolder", directory: other })

    expect(internal.getRootDirectory()).toBe(repo)
    expect(internal.getSessionRefreshContext(0).workspaceFolders?.() ?? []).toEqual([])
  })

  it("keep code-action paths workspace-relative", () => {
    expect(codePath({ scheme: "file", fsPath: path.join(repo, "src", "a.ts") } as never, repo)).toBe(
      vscode.workspace.asRelativePath({ fsPath: path.join(repo, "src", "a.ts") } as never),
    )
  })

  it("report no active file for a non-file editor such as a Git diff, as before", async () => {
    const file = path.join(repo, "src", "a.ts")
    window.visibleTextEditors = []
    window.tabGroups = { all: [] }
    window.activeTextEditor = { document: { uri: { scheme: "git", fsPath: file, path: file } } }

    const ctx = await provider().internal.gatherEditorContext(repo)

    expect(ctx.activeFile).toBeUndefined()
  })

  it("leave files outside the folder out of the editor context", async () => {
    const file = path.join(other, "src", "b.ts")
    window.visibleTextEditors = [{ document: { uri: { scheme: "file", fsPath: file, path: file } } }]
    window.activeTextEditor = { document: { uri: { scheme: "file", fsPath: file, path: file } } }
    window.tabGroups = {
      all: [{ tabs: [{ input: new vscode.TabInputText({ scheme: "file", fsPath: file } as never) }] }],
    }

    const ctx = await provider().internal.gatherEditorContext(repo)

    expect(ctx.visibleFiles).toBeUndefined()
    expect(ctx.openTabs).toBeUndefined()
    expect(ctx.activeFile).toBeUndefined()
  })

  it("search the session folder for a missing file link, as before", async () => {
    const searched: unknown[] = []
    workspace.fs.stat = async (target: { fsPath: string }) => ({ type: statSync(target.fsPath).isDirectory() ? 2 : 1 })
    workspace.findFiles = async (pattern: unknown) => {
      searched.push(pattern)
      return []
    }
    window.showWarningMessage = async () => undefined
    // The session lives outside the workspace folder, and the folder has the file.
    workspace.workspaceFolders = [{ uri: { fsPath: other, scheme: "file", path: other }, name: "other" }]

    handleEditorAction({ type: "openFile", filePath: "src/b.ts" } as never, { dir: () => repo })
    for (let tries = 0; tries < 100 && searched.length === 0; tries++) await Bun.sleep(5)

    expect(searched).toHaveLength(1)
  })

  it("open Agent Manager terminals in the first folder", () => {
    expect(createTerminalHost(() => other).repoPath()).toBe(repo)
  })

  it("check autocomplete ignore rules exactly like the folder's own controller", async () => {
    writeFileSync(path.join(repo, ".kilocodeignore"), "secret.ts\n")
    const plain = new FileIgnoreController(repo)
    await plain.initialize()
    const workspaceIgnore = new WorkspaceIgnoreController(() => [repo])
    await workspaceIgnore.initialize()
    const slashed = path.join(repo, "src", "a.ts").replaceAll("\\", "/")
    const inputs = [
      path.join(repo, "src", "a.ts"),
      path.join(repo, "secret.ts"),
      path.join(other, "src", "b.ts"),
      "src/a.ts",
      `file://${slashed.startsWith("/") ? "" : "/"}${slashed}`,
      `file:///${slashed.replace(/^\//, "")}`,
    ]

    for (const input of inputs) expect(workspaceIgnore.validateAccess(input)).toBe(plain.validateAccess(input))
  })
})
