// Auto-approve is owned by the extension host, so it also covers sessions in worktrees the panel is not showing and
// works while no webview is mounted. These tests drive the sweep and the provider wiring without a panel or webview.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import { AgentManagerProvider } from "../src/agent-manager/AgentManagerProvider"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import type { Host } from "../src/agent-manager/host"
import {
  createHostAutoApprove,
  setHostAutoApprove,
  type HostAutoApproveState,
} from "../src/agent-manager/provider-auto-approve"

const window = vscode.window as unknown as Record<string, unknown>
window.onDidCloseTerminal ??= () => ({ dispose: () => undefined })
window.onDidChangeActiveTerminal ??= () => ({ dispose: () => undefined })
window.createTerminal ??= () => ({ show: () => undefined, dispose: () => undefined, exitStatus: undefined })
window.createOutputChannel ??= () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined })

const directories: string[] = []

afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function request(id: string, metadata?: Record<string, unknown>) {
  return { id, sessionID: `ses_${id}`, action: "bash", resources: ["ls"], metadata } as never
}

function asked(id: string, directory: string, metadata?: Record<string, unknown>) {
  return {
    type: "permission.asked",
    created: 1,
    location: { directory },
    data: request(id, metadata),
  } as never
}

/** A client whose permission reply and pending list are observable, and whose other calls do nothing. */
function fakeClient(pending: Map<string, unknown[]>, replied: string[]) {
  return {
    permission: {
      reply: async (input: { requestID: string }) => {
        replied.push(input.requestID)
      },
      request: {
        list: async (input: { location: { directory: string } }) => ({
          location: input.location,
          data: pending.get(input.location.directory) ?? [],
        }),
      },
    },
    session: {
      get: async () => undefined,
      list: async () => ({ data: [] }),
      active: async () => ({}),
      context: async () => [],
      interrupt: async () => true,
    },
    form: {},
  }
}

describe("host auto-approve sweep", () => {
  test("approves a permission event with no webview mounted", async () => {
    let enabled = true
    setHostAutoApprove({ enabled: () => enabled, directory: "/ws" })
    const replied: string[] = []
    const client = fakeClient(new Map(), replied)
    const auto = createHostAutoApprove({
      client: async () => client as never,
      directories: () => ["/repo/.kilo/worktrees/one"],
      log: () => undefined,
    })

    auto.event(asked("per_1", "/repo/.kilo/worktrees/one"))
    await tick()

    expect(replied).toEqual(["per_1"])
    enabled = false
  })

  test("sweeps pending requests of every project and worktree when the toggle turns on", async () => {
    let enabled = false
    setHostAutoApprove({ enabled: () => enabled, directory: "/ws" })
    const pending = new Map<string, unknown[]>([
      ["/ws", [request("per_ws")]],
      ["/repo", [request("per_root")]],
      ["/repo/.kilo/worktrees/one", [request("per_tree")]],
    ])
    const replied: string[] = []
    const auto = createHostAutoApprove({
      client: async () => fakeClient(pending, replied) as never,
      directories: () => ["/repo", "/repo/.kilo/worktrees/one"],
      log: () => undefined,
    })

    auto.sweep()
    await tick()
    expect(replied).toEqual([])

    enabled = true
    auto.sweep()
    await tick()
    expect(replied.toSorted()).toEqual(["per_root", "per_tree", "per_ws"])
  })

  test("replies once per request and never to a sandbox escalation", async () => {
    setHostAutoApprove({ enabled: () => true, directory: "/ws" })
    const replied: string[] = []
    const auto = createHostAutoApprove({
      client: async () => fakeClient(new Map(), replied) as never,
      directories: () => ["/ws"],
      log: () => undefined,
    })

    auto.event(asked("per_once", "/ws"))
    auto.event(asked("per_once", "/ws"))
    auto.event(asked("per_sandbox", "/ws", { sandboxEscalation: true }))
    await tick()

    expect(replied).toEqual(["per_once"])
  })
})

function temporaryWorkspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "am-auto-approve-")))
  directories.push(root)
  return root
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
  let opened = 0
  const provider = new AgentManagerProvider(host, connection, {
    open: () => {
      opened += 1
      return panel
    },
    restore: () => panel,
  } as never)
  return { provider, opened: () => opened }
}

describe("Agent Manager host wiring", () => {
  test("approves a pending permission without ever opening the panel", async () => {
    const root = temporaryWorkspace()
    const pending = new Map<string, unknown[]>([[root, [request("per_host")]]])
    const replied: string[] = []
    const client = fakeClient(pending, replied)
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
    setHostAutoApprove({ enabled: () => true, directory: root } satisfies HostAutoApproveState)
    const { provider, opened } = providerAt(root, connection)

    // The connection opens, which sweeps the requests that were pending before it connected.
    states.forEach((listener) => listener("connected"))
    await tick()

    expect(replied).toEqual(["per_host"])
    expect(opened()).toBe(0)
    await provider.dispose()
  })
})