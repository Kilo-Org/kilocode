// A session can move to a directory the project does not track, for example when an agent calls the pinned
// opencode.session_move tool. The root cache must still follow that move, so this drives the provider subscription
// rather than the cache module alone.
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

/** A client that reports no session, so a cache miss would resolve to undefined instead of the event directory. */
function fakeClient() {
  return {
    session: {
      get: async () => undefined,
      list: async () => ({ data: [] }),
      active: async () => ({}),
      context: async () => [],
      interrupt: async () => true,
    },
    permission: { request: { list: async () => ({ data: [] }) } },
    form: {},
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
    const listeners: Array<{ listener: (event: never) => void; filter?: (event: never) => boolean }> = []
    const client = fakeClient()
    const connection = {
      client: async () => client,
      current: () => client,
      state: () => "connected",
      onState: () => () => undefined,
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
    const provider = providerAt(root, connection)
    const outside = path.join(root, "outside")
    const event = {
      type: "session.moved",
      location: { directory: outside },
      data: { sessionID: "ses_child", location: { directory: outside } },
    } as never

    // Deliver as the connection does: every listener whose filter passes the event.
    const delivered = listeners.filter(({ filter }) => !filter || filter(event))
    delivered.forEach(({ listener }) => listener(event))

    expect(await provider.sessionRoots.get("ses_child")).toBe(outside)
    await provider.dispose()
  })
})
