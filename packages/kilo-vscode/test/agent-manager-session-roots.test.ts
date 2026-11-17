// A session can move to a directory the project does not track, for example when an agent calls the pinned
// session_move tool, and the event stream can drop events while it reconnects. The root cache must follow both, so
// these tests drive the provider subscriptions rather than the cache module alone.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import { AgentManagerProvider } from "../src/agent-manager/AgentManagerProvider"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import type { Host } from "../src/agent-manager/host"

const window = vscode.window as unknown as Record<string, unknown>
window.createTerminal ??= () => ({ show: () => undefined, dispose: () => undefined, exitStatus: undefined })
window.createOutputChannel ??= () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined })

const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) await removeTemporaryWorkspace(dir)
})

// Provider shutdown is asynchronous and can still have a process with this directory as its working directory on
// Windows, which locks it for a moment. Keep retrying, then leave the disposable directory to the OS.
async function removeTemporaryWorkspace(dir: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 49) {
        console.warn(`Could not remove the temporary workspace ${dir}: ${String(error)}`)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

function temporaryWorkspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "am-session-roots-")))
  dirs.push(root)
  return root
}

/** A client whose `session.get` answers from `known`, so a cache miss shows up as a fresh server read. */
function fakeClient(known: Record<string, string>) {
  return {
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        const directory = known[sessionID]
        if (!directory) throw new Error("not found")
        return { id: sessionID, location: { directory } }
      },
      list: async () => ({ data: [] }),
      active: async () => ({}),
      context: async () => [],
      interrupt: async () => true,
    },
    permission: { request: { list: async () => ({ data: [] }) } },
    form: {},
  }
}

function fakeConnection(client: unknown) {
  const listeners: Array<{ listener: (event: never) => void; filter?: (event: never) => boolean }> = []
  const states: Array<(status: string) => void> = []
  const connection = {
    client: async () => client,
    current: () => client,
    state: () => "connected",
    onState: (listener: (status: string) => void) => {
      states.push(listener)
      return () => undefined
    },
    onEvent: (listener: (event: never) => void, filter?: (event: never) => boolean) => {
      listeners.push({ listener, filter })
      return () => undefined
    },
    server: () => undefined,
    view: () => undefined,
    started: () => undefined,
    stopped: () => undefined,
    dispose: () => undefined,
  } as unknown as AgentManagerConnection
  return {
    connection,
    // Deliver as the connection does: every listener whose filter passes the event.
    emit: (event: never) =>
      listeners.filter(({ filter }) => !filter || filter(event)).forEach(({ listener }) => listener(event)),
    status: (status: string) => states.forEach((listener) => listener(status)),
  }
}

function providerAt(root: string, connection: AgentManagerConnection) {
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
  return new AgentManagerProvider(host, connection, {
    open: () => panel,
    restore: () => panel,
  } as never)
}

describe("Agent Manager session roots", () => {
  test("follows a move to a directory the project does not track", async () => {
    const root = temporaryWorkspace()
    const fake = fakeConnection(fakeClient({}))
    const provider = providerAt(root, fake.connection)
    const outside = path.join(root, "outside")

    fake.emit({
      type: "session.moved",
      location: { directory: outside },
      data: { sessionID: "ses_child", location: { directory: outside } },
    } as never)

    expect(await provider.sessionRoots.get("ses_child")).toBe(outside)
    await provider.dispose()
  })

  test("reads the server again after the event stream reconnects", async () => {
    const root = temporaryWorkspace()
    const known = { ses_child: path.join(root, "first") }
    const fake = fakeConnection(fakeClient(known))
    const provider = providerAt(root, fake.connection)

    expect(await provider.sessionRoots.get("ses_child")).toBe(path.join(root, "first"))
    // The move happened while the stream was down, so no session.moved event arrives.
    known.ses_child = path.join(root, "second")
    fake.status("connecting")
    fake.status("connected")

    expect(await provider.sessionRoots.get("ses_child")).toBe(path.join(root, "second"))
    await provider.dispose()
  })
})
