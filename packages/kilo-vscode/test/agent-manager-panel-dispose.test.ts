import { describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import { AgentManagerProvider } from "../src/agent-manager/AgentManagerProvider"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import type { Host, PanelContext } from "../src/agent-manager/host"

const window = vscode.window as unknown as Record<string, unknown>
window.onDidCloseTerminal ??= () => ({ dispose: () => undefined })
window.onDidChangeActiveTerminal ??= () => ({ dispose: () => undefined })
window.createTerminal ??= () => ({ show: () => undefined, dispose: () => undefined, exitStatus: undefined })
window.createOutputChannel ??= () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined })

function fakePanel() {
  const callbacks: Array<() => void> = []
  const panel: PanelContext & { fireDispose: () => void } = {
    active: true,
    visible: true,
    postMessage: () => undefined,
    waitForReady: async () => undefined,
    waitForActive: async () => undefined,
    reveal: () => undefined,
    onDidChangeVisibility: () => ({ dispose: () => undefined }),
    onDidDispose: (cb) => {
      callbacks.push(cb)
      return { dispose: () => undefined }
    },
    dispose: () => callbacks.forEach((cb) => cb()),
    fireDispose: () => callbacks.forEach((cb) => cb()),
  }
  return panel
}

describe("Agent Manager panel dispose", () => {
  it("aborts only the panel's busy sessions", async () => {
    const interrupt = mock(async () => true)
    const view = mock(() => undefined)
    const client = { session: { interrupt } }
    const connection = {
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

    const listeners: Array<(event: unknown) => void> = []
    connection.onEvent = (listener: (event: never) => void) => {
      listeners.push(listener as unknown as (event: unknown) => void)
      return () => undefined
    }
    const emit = (event: unknown) => listeners.forEach((listener) => listener(event))

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
      workspacePath: () => undefined,
      onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
    }
    const host = new Proxy(base, {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target]
        return () => ({ dispose: () => undefined })
      },
    }) as unknown as Host

    const panel = fakePanel()
    const provider = new AgentManagerProvider(host, connection, {
      open: () => panel,
      restore: () => panel,
    } as never)

    provider.openPanel()
    provider.trackOpenSessions(["busy-open", "idle-open"])
    provider.trackVisibleSession("busy-visible")

    const started = (sessionID: string) => ({
      type: "session.execution.started",
      data: { sessionID },
      location: { directory: "/repo" },
    })
    emit(started("busy-open"))
    emit(started("busy-visible"))
    emit({ type: "session.idle", data: { sessionID: "idle-open" }, location: { directory: "/repo" } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    panel.fireDispose()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const ids = (interrupt.mock.calls as unknown as Array<[{ sessionID: string }]>)
      .map((call) => call[0].sessionID)
      .sort()
    expect(ids).toEqual(["busy-open", "busy-visible"])
    expect(interrupt).toHaveBeenCalledWith({ sessionID: "busy-open" })
    expect(view).toHaveBeenCalledWith([])
  })
})