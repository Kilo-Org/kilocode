import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"

const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  postMessage: (message: unknown) => void
  reloadAfterAuthChange: () => Promise<void>
  handleLoadSessions: () => Promise<void>
  announceFolder: (quiet?: boolean) => void
  handleFolderMessage: (message: { type: string; directory?: unknown }) => void
  getRootDirectory: () => string
  getSessionRefreshContext: (revision: number) => { workspaceFolders?: () => string[] }
  contextSessionID: string | undefined
  sessionDirectories: Map<string, string>
}

const workspace = vscode.workspace as unknown as { workspaceFolders?: unknown }
const window = vscode.window as unknown as { activeTextEditor?: unknown }
const folders = workspace.workspaceFolders
const editor = window.activeTextEditor

const open = (fsPath: string) => {
  window.activeTextEditor = { document: { uri: { scheme: "file", fsPath } } }
}

function setup(opts: Record<string, unknown> = {}) {
  const messages: Array<{ type?: string; [key: string]: unknown }> = []
  const calls = { reload: 0, sessions: 0 }
  const provider = new KiloProvider({} as never, { getClient: () => undefined } as never, undefined, opts as never)
  const internal = provider as unknown as Internals
  internal.postMessage = (message) => messages.push(message as { type?: string })
  internal.reloadAfterAuthChange = async () => {
    calls.reload++
  }
  internal.handleLoadSessions = async () => {
    calls.sessions++
  }
  return { internal, messages, calls }
}

const last = (messages: Array<{ type?: string }>, type: string) => messages.filter((item) => item.type === type).at(-1)

beforeEach(() => {
  workspace.workspaceFolders = ["/a", "/b", "/c"].map((fsPath) => ({ uri: { fsPath }, name: fsPath.slice(1) }))
})

afterEach(() => {
  workspace.workspaceFolders = folders
  window.activeTextEditor = editor
})

describe("KiloProvider workspace folders", () => {
  it("starts new work in the active editor's folder", () => {
    open("/b/src/x.ts")
    const { internal, messages } = setup()

    internal.announceFolder(true)

    expect(internal.getRootDirectory()).toBe("/b")
    expect(last(messages, "workspaceFoldersLoaded")).toMatchObject({
      selected: "/b",
      folders: [
        { path: "/a", name: "a" },
        { path: "/b", name: "b" },
        { path: "/c", name: "c" },
      ],
    })
  })

  it("lets the picker override the editor and reloads folder-scoped lists", () => {
    open("/b/src/x.ts")
    const { internal, messages, calls } = setup()
    internal.announceFolder(true)

    internal.handleFolderMessage({ type: "selectWorkspaceFolder", directory: "/a" })

    expect(internal.getRootDirectory()).toBe("/a")
    expect(last(messages, "workspaceDirectoryChanged")).toEqual({ type: "workspaceDirectoryChanged", directory: "/a" })
    expect(last(messages, "configBindingExpired")).toBeDefined()
    expect(calls.reload).toBe(1)
    expect(calls.sessions).toBe(1)
  })

  it("lists history only for folders that new work has targeted", () => {
    open("/b/src/x.ts")
    const { internal } = setup()
    internal.announceFolder(true)
    internal.handleFolderMessage({ type: "selectWorkspaceFolder", directory: "/a" })

    expect(internal.getSessionRefreshContext(0).workspaceFolders?.()).toEqual(["/a", "/b"])
  })

  it("keeps an open session's folder regardless of the editor", () => {
    open("/b/src/x.ts")
    const { internal } = setup()
    internal.sessionDirectories.set("ses_1", "/c")
    internal.contextSessionID = "ses_1"

    expect(internal.getRootDirectory()).toBe("/c")
  })

  it("does not reload when the folder stays the same", () => {
    open("/b/src/x.ts")
    const { internal, calls } = setup()
    internal.announceFolder(true)

    open("/b/src/y.ts")
    internal.announceFolder()

    expect(calls.reload).toBe(0)
  })

  it("leaves Agent Manager and Settings panels on their own directory", () => {
    open("/b/src/x.ts")
    const manager = setup({ rootDirectory: () => "/a" })
    const settings = setup({ projectDirectory: "/a" })

    manager.internal.announceFolder()
    settings.internal.announceFolder()

    expect(manager.internal.getRootDirectory()).toBe("/a")
    expect(last(manager.messages, "workspaceFoldersLoaded")).toBeUndefined()
    expect(last(settings.messages, "workspaceFoldersLoaded")).toBeUndefined()
    expect(manager.internal.getSessionRefreshContext(0).workspaceFolders).toBeUndefined()
  })
})
