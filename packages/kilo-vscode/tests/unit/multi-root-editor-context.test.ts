import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import * as path from "path"
import { codePath } from "../../src/services/code-actions/editor-utils"
import { handleEditorAction } from "../../src/kilo-provider/editor-actions"

const { KiloProvider } = await import("../../src/KiloProvider")

type Mutable = Record<string, unknown>
const workspace = vscode.workspace as unknown as Mutable & { fs: Mutable }
const window = vscode.window as unknown as Mutable
const saved = {
  folders: workspace.workspaceFolders,
  stat: workspace.fs.stat,
  open: workspace.openTextDocument,
  show: window.showTextDocument,
  pick: window.showQuickPick,
  tabs: window.tabGroups,
  visible: window.visibleTextEditors,
  active: window.activeTextEditor,
}

const slash = (value: string) => value.replaceAll("\\", "/")
const uri = (fsPath: string) => ({ scheme: "file", fsPath, path: slash(fsPath) })

let root = ""
let alpha = ""
let beta = ""

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kilo-mr-ctx-"))
  alpha = path.join(root, "alpha")
  beta = path.join(root, "beta")
  for (const dir of [path.join(alpha, "src"), path.join(beta, "src"), path.join(alpha, ".kilo", "worktrees", "wt")]) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(path.join(alpha, "src", "a.ts"), "")
  writeFileSync(path.join(beta, "src", "b.ts"), "")
  writeFileSync(path.join(beta, "src", "secret.ts"), "")
  writeFileSync(path.join(beta, ".kilocodeignore"), "src/secret.ts\n")
  workspace.workspaceFolders = [alpha, beta].map((fsPath) => ({
    uri: { ...uri(fsPath) },
    name: path.basename(fsPath),
  }))
})

afterEach(() => {
  workspace.workspaceFolders = saved.folders
  workspace.fs.stat = saved.stat
  workspace.openTextDocument = saved.open
  window.showTextDocument = saved.show
  window.showQuickPick = saved.pick
  window.tabGroups = saved.tabs
  window.visibleTextEditors = saved.visible
  window.activeTextEditor = saved.active
  rmSync(root, { recursive: true, force: true })
})

describe("codePath", () => {
  it("keeps the workspace-relative path in single-folder windows", () => {
    workspace.workspaceFolders = [{ uri: { fsPath: "/repo" } }]
    expect(codePath(uri("/repo/src/x.ts") as never, "/repo")).toBe("src/x.ts")
  })

  it("is relative to the chat's root when the file is inside it", () => {
    expect(codePath(uri(path.join(beta, "src", "b.ts")) as never, beta)).toBe("src/b.ts")
  })

  it("is absolute for files in another folder, never prefixed by the folder name", () => {
    const file = path.join(beta, "src", "b.ts")
    expect(codePath(uri(file) as never, alpha)).toBe(slash(file))
    expect(codePath(uri(file) as never)).toBe(slash(file))
  })
})

describe("editor context in multi-root windows", () => {
  type Internals = { gatherEditorContext: (dir?: string) => Promise<Record<string, unknown>> }

  const editor = (fsPath: string) => ({ document: { uri: uri(fsPath) } })
  const tab = (fsPath: string) => ({ input: new vscode.TabInputText(uri(fsPath) as never) })

  it("lists files of other workspace folders by absolute path, through their own ignore rules", async () => {
    const a = path.join(alpha, "src", "a.ts")
    const b = path.join(beta, "src", "b.ts")
    const secret = path.join(beta, "src", "secret.ts")
    window.visibleTextEditors = [editor(a), editor(b), editor(secret)]
    window.activeTextEditor = editor(b)
    window.tabGroups = { all: [{ tabs: [tab(a), tab(b), tab(secret), tab(path.join(root, "outside.ts"))] }] }
    const provider = new KiloProvider({} as never, { getClient: () => undefined } as never)

    const ctx = await (provider as unknown as Internals).gatherEditorContext(alpha)

    expect(ctx.visibleFiles).toEqual([path.join("src", "a.ts"), slash(b)])
    expect(ctx.openTabs).toEqual(["src/a.ts", slash(b)])
    expect(ctx.activeFile).toBe(slash(b))
  })

  it("never points a worktree session at its main checkout's files", async () => {
    const a = path.join(alpha, "src", "a.ts")
    window.visibleTextEditors = [editor(a)]
    window.activeTextEditor = editor(a)
    window.tabGroups = { all: [{ tabs: [tab(a)] }] }
    const provider = new KiloProvider({} as never, { getClient: () => undefined } as never)

    const ctx = await (provider as unknown as Internals).gatherEditorContext(
      path.join(alpha, ".kilo", "worktrees", "wt"),
    )

    expect(ctx.visibleFiles).toBeUndefined()
    expect(ctx.openTabs).toBeUndefined()
    expect(ctx.activeFile).toBeUndefined()
  })
})

describe("file links across workspace folders", () => {
  function track() {
    const shown: string[] = []
    const picks: string[][] = []
    workspace.fs.stat = async (target: { fsPath: string }) => {
      const stat = statSync(target.fsPath)
      return { type: stat.isDirectory() ? 2 : 1 }
    }
    workspace.openTextDocument = async (target: { fsPath: string }) => ({ uri: target })
    window.showTextDocument = async (doc: { uri: { fsPath: string } }) => void shown.push(path.resolve(doc.uri.fsPath))
    window.showQuickPick = async (items: Array<{ label: string }>) => {
      picks.push(items.map((item) => item.label))
      return undefined
    }
    return { shown, picks }
  }

  const open = (dir: string, filePath: string) =>
    handleEditorAction({ type: "openFile", filePath } as never, { dir: () => dir })

  const settle = async (done: () => boolean) => {
    for (let tries = 0; tries < 100 && !done(); tries++) await Bun.sleep(10)
  }

  it("opens a relative path from another workspace folder", async () => {
    const { shown } = track()

    open(alpha, "src/b.ts")
    await settle(() => shown.length > 0)

    expect(shown).toEqual([path.resolve(beta, "src", "b.ts")])
  })

  it("asks which folder to use when several have the file", async () => {
    const gamma = path.join(root, "gamma")
    mkdirSync(path.join(gamma, "src"), { recursive: true })
    writeFileSync(path.join(gamma, "src", "b.ts"), "")
    workspace.workspaceFolders = [alpha, beta, gamma].map((fsPath) => ({
      uri: uri(fsPath),
      name: path.basename(fsPath),
    }))
    const { picks } = track()

    open(alpha, "src/b.ts")
    await settle(() => picks.length > 0)

    expect(picks).toEqual([["beta/src/b.ts", "gamma/src/b.ts"]])
  })
})
