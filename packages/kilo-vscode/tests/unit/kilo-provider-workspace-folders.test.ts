import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { mkdirSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import * as path from "path"

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
  it("starts in the first folder until a root is picked, whatever the editor shows", () => {
    open("/b/src/x.ts")
    const { internal, messages } = setup()

    internal.announceFolder(true)

    expect(internal.getRootDirectory()).toBe("/a")
    expect(last(messages, "workspaceFoldersLoaded")).toMatchObject({
      selected: "/a",
      folders: [
        { path: "/a", name: "a" },
        { path: "/b", name: "b" },
        { path: "/c", name: "c" },
      ],
    })
  })

  it("switches to the picked root and reloads folder-scoped lists", () => {
    const { internal, messages, calls } = setup()
    internal.announceFolder(true)

    internal.handleFolderMessage({ type: "selectWorkspaceFolder", directory: "/b" })

    expect(internal.getRootDirectory()).toBe("/b")
    expect(last(messages, "workspaceDirectoryChanged")).toEqual({ type: "workspaceDirectoryChanged", directory: "/b" })
    expect(last(messages, "configBindingExpired")).toBeDefined()
    expect(calls.reload).toBe(1)
    expect(calls.sessions).toBe(1)
  })

  it("keeps the picked root when the editor moves to another folder", () => {
    const { internal, calls } = setup()
    internal.announceFolder(true)
    internal.handleFolderMessage({ type: "selectWorkspaceFolder", directory: "/b" })

    open("/c/src/x.ts")
    internal.announceFolder()

    expect(internal.getRootDirectory()).toBe("/b")
    expect(calls.reload).toBe(1)
  })

  it("ignores a picked directory outside the workspace", () => {
    const { internal } = setup()

    internal.handleFolderMessage({ type: "selectWorkspaceFolder", directory: "/elsewhere" })

    expect(internal.getRootDirectory()).toBe("/a")
  })

  it("lists history only for folders that new work has targeted", () => {
    const { internal } = setup()
    internal.announceFolder(true)
    internal.handleFolderMessage({ type: "selectWorkspaceFolder", directory: "/b" })

    expect(internal.getSessionRefreshContext(0).workspaceFolders?.()).toEqual(["/a", "/b"])
  })

  it("keeps an open session's folder regardless of the picked root", () => {
    const { internal } = setup()
    internal.sessionDirectories.set("ses_1", "/c")
    internal.contextSessionID = "ses_1"

    expect(internal.getRootDirectory()).toBe("/c")
  })

  it("does not reload when the same root is picked again", () => {
    const { internal, calls } = setup()
    internal.announceFolder(true)

    internal.handleFolderMessage({ type: "selectWorkspaceFolder", directory: "/a" })

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
    // Settings panels list the folders, but keep their own project selected.
    expect(last(settings.messages, "workspaceFoldersLoaded")).toMatchObject({ selected: "/a" })
    expect(settings.calls.reload).toBe(0)
    expect(manager.internal.getSessionRefreshContext(0).workspaceFolders).toBeUndefined()
  })
})

describe("KiloProvider Settings panel folders", () => {
  type Panel = Internals & {
    projectDirectory: string | null | undefined
    configProject: (dir: string) => { root: string } | undefined
    validConfigProject: (project: { id: string; root: string; generation: number; pinned: boolean }) => boolean
  }

  it("lists the folders with the panel's own project selected", () => {
    const { internal, messages } = setup({ projectDirectory: "/b" })

    internal.announceFolder()

    expect(last(messages, "workspaceFoldersLoaded")).toMatchObject({ selected: "/b" })
  })

  it("switches the panel's project when a folder is chosen", () => {
    const { internal, messages } = setup({ projectDirectory: "/b" })
    const panel = internal as unknown as Panel

    internal.handleFolderMessage({ type: "selectWorkspaceFolder", directory: "/a" })

    expect(panel.projectDirectory).toBe("/a")
    expect(last(messages, "workspaceDirectoryChanged")).toEqual({ type: "workspaceDirectoryChanged", directory: "/a" })
    expect(last(messages, "configBindingExpired")).toBeDefined()
    expect(last(messages, "workspaceFoldersLoaded")).toMatchObject({ selected: "/a" })
  })

  it("ignores a chosen directory outside the workspace", () => {
    const { internal } = setup({ projectDirectory: "/b" })

    internal.handleFolderMessage({ type: "selectWorkspaceFolder", directory: "/elsewhere" })

    expect((internal as unknown as Panel).projectDirectory).toBe("/b")
  })

  it("binds Local Config to any workspace folder, not only the first", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kilo-mr-"))
    const dirs = ["alpha", "beta"].map((name) => path.join(root, name))
    dirs.forEach((dir) => mkdirSync(dir))
    workspace.workspaceFolders = dirs.map((fsPath) => ({ uri: { fsPath }, name: path.basename(fsPath) }))
    open(path.join(dirs[0]!, "a.ts"))
    const { internal } = setup({ projectDirectory: dirs[1] })
    const panel = internal as unknown as Panel

    const project = panel.configProject(dirs[1]!)

    expect(project).toBeDefined()
    expect(panel.validConfigProject(project as never)).toBe(true)
    expect(panel.configProject(root)).toBeUndefined()
    rmSync(root, { recursive: true, force: true })
  })
})

describe("KiloProvider Settings › Indexing folders", () => {
  type Indexing = Internals & {
    projectDirectory: string | null | undefined
    fetchAndSendIndexingStatus: (dir?: string, id?: string) => Promise<void>
    sendIndexingSettings: (id?: string) => Promise<{ id: string; root: string } | undefined>
    selectIndexingProject: (id?: string) => Promise<void>
  }
  type Loaded = { settings: { projects: Array<{ id: string; root: string; label: string }>; projectId?: string } }

  function panel(dir: string, dirs: string[]) {
    const store = new Map<string, unknown>()
    const context = {
      globalState: {
        get: (key: string) => store.get(key),
        update: async (key: string, value: unknown) => void store.set(key, value),
      },
      workspaceState: { get: () => undefined, update: async () => {} },
    }
    workspace.workspaceFolders = dirs.map((fsPath) => ({ uri: { fsPath }, name: path.basename(fsPath) }))
    const messages: Array<{ type?: string; [key: string]: unknown }> = []
    const statuses: Array<string | undefined> = []
    const provider = new KiloProvider(
      {} as never,
      { getClient: () => undefined } as never,
      context as never,
      { projectDirectory: dir } as never,
    )
    const internal = provider as unknown as Indexing
    internal.postMessage = (message) => messages.push(message as { type?: string })
    internal.reloadAfterAuthChange = async () => {}
    internal.fetchAndSendIndexingStatus = async (target) => void statuses.push(target)
    return { internal, messages, statuses }
  }

  const loaded = (messages: Array<{ type?: string }>) => last(messages, "indexingSettingsLoaded") as unknown as Loaded

  it("lists every workspace folder and starts on the panel's folder", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kilo-mr-"))
    const dirs = ["alpha", "beta"].map((name) => path.join(root, name))
    dirs.forEach((dir) => mkdirSync(dir))
    const { internal, messages } = panel(dirs[1]!, dirs)

    await internal.sendIndexingSettings()

    const settings = loaded(messages).settings
    expect(settings.projects.map((item) => item.label)).toEqual(["beta", "alpha"])
    expect(settings.projectId).toBe(settings.projects[0]!.id)
    rmSync(root, { recursive: true, force: true })
  })

  it("moves the Settings folder when another folder is chosen for indexing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kilo-mr-"))
    const dirs = ["alpha", "beta"].map((name) => path.join(root, name))
    dirs.forEach((dir) => mkdirSync(dir))
    const { internal, messages, statuses } = panel(dirs[1]!, dirs)
    await internal.sendIndexingSettings()
    const alpha = loaded(messages).settings.projects.find((item) => item.label === "alpha")!

    await internal.selectIndexingProject(alpha.id)

    expect(internal.projectDirectory).toBe(dirs[0])
    expect(statuses).toContain(alpha.root)
    expect(loaded(messages).settings.projectId).toBe(alpha.id)
    rmSync(root, { recursive: true, force: true })
  })

  it("follows the Settings folder dropdown", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kilo-mr-"))
    const dirs = ["alpha", "beta"].map((name) => path.join(root, name))
    dirs.forEach((dir) => mkdirSync(dir))
    const { internal, messages } = panel(dirs[1]!, dirs)
    await internal.sendIndexingSettings()

    const before = messages.length
    internal.handleFolderMessage({ type: "selectWorkspaceFolder", directory: dirs[0] })
    // The project list resolves Git roots in a subprocess, so wait for the refreshed list.
    for (let tries = 0; tries < 200; tries++) {
      if (messages.slice(before).some((item) => item.type === "indexingSettingsLoaded")) break
      await Bun.sleep(10)
    }

    const settings = loaded(messages).settings
    expect(settings.projects[0]!.label).toBe("alpha")
    expect(settings.projectId).toBe(settings.projects[0]!.id)
    rmSync(root, { recursive: true, force: true })
  })
})
