import { afterEach, describe, expect, it, mock } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import { AgentManagerProvider } from "../src/agent-manager/AgentManagerProvider"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import type { Host } from "../src/agent-manager/host"

const window = vscode.window as unknown as Record<string, unknown>
window.onDidCloseTerminal ??= () => ({ dispose: () => undefined })
window.onDidChangeActiveTerminal ??= () => ({ dispose: () => undefined })
window.createTerminal ??= () => ({ show: () => undefined, dispose: () => undefined, exitStatus: undefined })
window.createOutputChannel ??= () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined })

const directories: string[] = []

afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
})

function workspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "am-visible-worktree-")))
  directories.push(root)
  return root
}

function connection() {
  const view = mock(() => undefined)
  const client = { session: { interrupt: mock(async () => true) }, permission: {}, form: {} }
  return {
    client: async () => client,
    current: () => client,
    state: () => "connected",
    onState: () => () => undefined,
    onEvent: () => () => undefined,
    server: () => undefined,
    view,
    started: () => undefined,
    stopped: () => undefined,
    dispose: () => undefined,
  } as unknown as AgentManagerConnection
}

function providerAt(root: string, conn: AgentManagerConnection = connection()) {
  const output = { appendLine: () => undefined, show: () => undefined, dispose: () => undefined }
  const base = {
    createOutput: () => output,
    readProjects: () => undefined,
    writeProjects: async () => undefined,
    autoBranchNaming: () => ({ enabled: false, prefix: "" }),
    extensionKeybindings: () => [],
    onDidChangeKeybindings: () => ({ dispose: () => undefined }),
    dirtyFiles: () => [],
    isTrusted: () => true,
    openDocument: async () => undefined,
    showError: () => undefined,
    notify: () => undefined,
    openFile: () => undefined,
    refreshGit: () => undefined,
    dispose: () => undefined,
    workspacePath: () => root,
    worktreePool: () => false,
    onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
    getPRMergeMethod: () => undefined,
    savePRMergeMethod: async () => undefined,
  }
  const host = new Proxy(base, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target]
      return () => ({ dispose: () => undefined })
    },
  }) as unknown as Host
  const panel = {
    active: true,
    visible: true,
    postMessage: () => undefined,
    waitForReady: async () => undefined,
    waitForActive: async () => undefined,
    reveal: () => undefined,
    onDidChangeVisibility: () => ({ dispose: () => undefined }),
    onDidDispose: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  }
  return new AgentManagerProvider(host, conn, {
    open: () => panel,
    restore: () => panel,
  } as never)
}

function seed(provider: AgentManagerProvider, root: string) {
  const ctx = provider.contexts.active()
  if (!ctx) throw new Error("expected a pinned project context")
  const state = ctx.stateManager()
  state.addWorktree({ branch: "first", path: path.join(root, "first"), parentBranch: "main" })
  state.addWorktree({ branch: "second", path: path.join(root, "second"), parentBranch: "main" })
  const [first, second] = state.getWorktrees()
  state.addSession("ses-first", first!.id)
  state.addSession("ses-second", second!.id)
  state.addSession("ses-local", null)
  const internal = provider.prBridge.poller as unknown as {
    active: boolean
    activeWorktreeId: string | undefined
    fetchOne: (id: string, ...rest: never[]) => Promise<void>
  }
  const fetched: string[] = []
  internal.active = true
  internal.fetchOne = async (id: string) => {
    fetched.push(id)
  }
  return { first: first!, second: second!, internal, fetched }
}

describe("Agent Manager viewed sessions", () => {
  it("marks only the session the user is reading as viewed", () => {
    const root = workspace()
    const conn = connection()
    const view = (conn as unknown as { view: ReturnType<typeof mock> }).view
    const provider = providerAt(root, conn)
    // Only the panel visibility matters here, so skip the panel lifecycle and its async state initialization.
    const internals = provider as unknown as { panel: { visible: boolean } }
    internals.panel = { visible: true }
    seed(provider, root)

    provider.trackOpenSessions(["ses-first", "ses-second"])
    provider.trackVisibleSession("ses-first")
    expect(view.mock.calls.at(-1)?.[0]).toEqual(["ses-first"])

    // A background tab stays unread, so its idle transition does not clear the indicator.
    provider.trackOpenSessions(["ses-first", "ses-second"])
    expect(view.mock.calls.at(-1)?.[0]).toEqual(["ses-first"])

    provider.trackVisibleSession(null)
    expect(view.mock.calls.at(-1)?.[0]).toEqual([])
  })
})

describe("Agent Manager visible session PR polling", () => {
  it("sets the poller's active worktree and fetches it immediately", () => {
    const root = workspace()
    const provider = providerAt(root)
    const { first, second, internal, fetched } = seed(provider, root)

    provider.trackVisibleSession("ses-first")
    expect(internal.activeWorktreeId).toBe(first.id)
    expect(fetched).toEqual([first.id])

    provider.trackVisibleSession("ses-second")
    expect(internal.activeWorktreeId).toBe(second.id)
    expect(fetched).toEqual([first.id, second.id])
  })

  it("clears the active worktree for a local session", () => {
    const root = workspace()
    const provider = providerAt(root)
    const { first, internal, fetched } = seed(provider, root)

    provider.trackVisibleSession("ses-first")
    expect(internal.activeWorktreeId).toBe(first.id)

    provider.trackVisibleSession("ses-local")
    expect(internal.activeWorktreeId).toBeUndefined()
    expect(fetched).toEqual([first.id])
  })

  it("clears the active worktree for an unknown session and for no session", () => {
    const root = workspace()
    const provider = providerAt(root)
    const { internal } = seed(provider, root)

    provider.trackVisibleSession("ses-missing")
    expect(internal.activeWorktreeId).toBeUndefined()

    provider.trackVisibleSession("ses-first")
    provider.trackVisibleSession(null)
    expect(internal.activeWorktreeId).toBeUndefined()
  })
})
