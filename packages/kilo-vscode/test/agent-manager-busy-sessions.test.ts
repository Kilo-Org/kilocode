import { describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import { AgentManagerProvider } from "../src/agent-manager/AgentManagerProvider"
import type { AgentManagerConnection, ConnectionState } from "../src/agent-manager/connection"
import type { Host, PanelContext } from "../src/agent-manager/host"
import { watchBusySessions } from "../src/agent-manager/session-lifecycle"

const window = vscode.window as unknown as Record<string, unknown>
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

function fakeHost(): Host {
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
  return new Proxy(base, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target]
      return () => ({ dispose: () => undefined })
    },
  }) as unknown as Host
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

describe("watchBusySessions", () => {
  it("clears busy state on non-connected transitions and reconciles on reconnect", async () => {
    let status: ConnectionState = "connected"
    let stateListener: ((next: ConnectionState) => void) | undefined
    let activeSnapshot: Record<string, unknown> = { s_still_running: {} }
    let connectedCount = 0
    let clearedCount = 0
    const reconciled: string[][] = []

    const busy = new Set(["s_finished_during_gap", "s_still_running"])
    const removed = new Set<string>()
    const tracker = watchBusySessions({
      connection: {
        state: () => status,
        current: () =>
          status === "disconnected"
            ? undefined
            : ({ session: { active: async () => activeSnapshot } } as never),
        onState: (listener) => {
          stateListener = listener
          return () => {
            stateListener = undefined
          }
        },
      },
      busy,
      removed,
      naming: {
        clearBusy: () => {
          clearedCount++
        },
        reconcileBusy: (active) => {
          reconciled.push([...active].sort())
        },
      },
      onConnected: () => {
        connectedCount++
      },
    })

    // Transient SSE drop clears busy sessions immediately.
    status = "connecting"
    stateListener?.("connecting")
    expect([...busy]).toEqual([])
    expect(clearedCount).toBe(1)

    // Reconnect reconciles against server's active sessions.
    status = "connected"
    stateListener?.("connected")
    await flush()
    expect(connectedCount).toBe(1)
    expect([...busy]).toEqual(["s_still_running"])
    expect(reconciled).toEqual([["s_still_running"]])

    // Full disconnect clears again.
    status = "disconnected"
    stateListener?.("disconnected")
    expect([...busy]).toEqual([])
    expect(clearedCount).toBe(2)

    // Reconnect with no active sessions leaves busy empty and notifies naming.
    activeSnapshot = {}
    status = "connected"
    stateListener?.("connected")
    await flush()
    expect([...busy]).toEqual([])
    expect(reconciled).toEqual([["s_still_running"], []])

    tracker.dispose()
  })

  it("merges live events arriving while reconnect reconciliation is in flight and ignores removed sessions", async () => {
    let status: ConnectionState = "connected"
    let stateListener: ((next: ConnectionState) => void) | undefined
    let resolveActive: ((value: Record<string, unknown>) => void) | undefined

    const busy = new Set<string>()
    const removed = new Set(["s_removed"])
    const reconciled: string[][] = []

    const tracker = watchBusySessions({
      connection: {
        state: () => status,
        current: () =>
          ({
            session: {
              active: () => new Promise<Record<string, unknown>>((resolve) => (resolveActive = resolve)),
            },
          }) as never,
        onState: (listener) => {
          stateListener = listener
          return () => undefined
        },
      },
      busy,
      removed,
      naming: {
        clearBusy: () => {},
        reconcileBusy: (active) => reconciled.push([...active].sort()),
      },
    })

    stateListener?.("connected")
    // Live events arrive while session.active() is still resolving.
    tracker.record("s_went_idle", false)
    tracker.record("s_started_live", true)
    resolveActive?.({ s_went_idle: {}, s_removed: {}, s_running: {} })
    await flush()

    expect([...busy].sort()).toEqual(["s_running", "s_started_live"])
    expect(reconciled).toEqual([["s_running", "s_started_live"]])
    tracker.dispose()
  })

  it("discards an in-flight reconcile if the connection drops again before it resolves", async () => {
    let status: ConnectionState = "connected"
    let stateListener: ((next: ConnectionState) => void) | undefined
    let resolveActive: ((value: Record<string, unknown>) => void) | undefined

    const busy = new Set<string>()
    const reconciled: string[][] = []
    const tracker = watchBusySessions({
      connection: {
        state: () => status,
        current: () =>
          ({
            session: {
              active: () => new Promise<Record<string, unknown>>((resolve) => (resolveActive = resolve)),
            },
          }) as never,
        onState: (listener) => {
          stateListener = listener
          return () => undefined
        },
      },
      busy,
      removed: new Set(),
      naming: {
        clearBusy: () => {},
        reconcileBusy: (active) => reconciled.push([...active]),
      },
    })

    stateListener?.("connected")
    status = "disconnected"
    stateListener?.("disconnected")
    resolveActive?.({ s1: {} })
    await flush()

    expect([...busy]).toEqual([])
    expect(reconciled).toEqual([])
    tracker.dispose()
  })
})

describe("AgentManagerProvider busySessions hardening", () => {
  it("does not mark idle session.status as busy and clears/reconciles busySessions across connection state changes", async () => {
    const interrupt = mock(async () => true)
    let activeSessions: Record<string, unknown> = {}
    let state: ConnectionState = "connected"
    const eventListeners: Array<(event: unknown) => void> = []
    const stateListeners: Array<(status: ConnectionState) => void> = []

    const client = {
      session: {
        interrupt,
        active: async () => activeSessions,
        list: async () => ({ data: [] }),
      },
      permission: { request: { list: async () => ({ data: [] }) } },
      form: { list: async () => ({ data: [] }) },
    }

    const connection = {
      client: async () => client,
      current: () => (state === "disconnected" ? undefined : client),
      state: () => state,
      onState: (listener: (next: ConnectionState) => void) => {
        stateListeners.push(listener)
        return () => undefined
      },
      onEvent: (listener: (event: never) => void) => {
        eventListeners.push(listener as unknown as (event: unknown) => void)
        return () => undefined
      },
      server: () => undefined,
      view: () => undefined,
      started: () => undefined,
      stopped: () => undefined,
      dispose: () => undefined,
    } as unknown as AgentManagerConnection

    const emitEvent = (event: unknown) => eventListeners.forEach((listener) => listener(event))
    const emitState = (next: ConnectionState) => {
      state = next
      stateListeners.forEach((listener) => listener(next))
    }

    const panel = fakePanel()
    const provider = new AgentManagerProvider(fakeHost(), connection, {
      open: () => panel,
      restore: () => panel,
    } as never)

    provider.openPanel()
    provider.trackOpenSessions(["s_idle", "s_gap", "s_live"])

    // session.status with type "idle" must clear (never add) busySessions.
    emitEvent({ type: "session.status", data: { sessionID: "s_idle", status: { type: "busy" } } })
    expect(provider.busySessions.has("s_idle")).toBe(true)
    emitEvent({ type: "session.status", data: { sessionID: "s_idle", status: { type: "idle" } } })
    expect(provider.busySessions.has("s_idle")).toBe(false)

    // Two sessions start running, then SSE drops and s_gap finishes during the gap while s_live stays active.
    emitEvent({ type: "session.execution.started", data: { sessionID: "s_gap" } })
    emitEvent({ type: "session.execution.started", data: { sessionID: "s_live" } })
    expect([...provider.busySessions].sort()).toEqual(["s_gap", "s_live"])

    emitState("connecting")
    expect([...provider.busySessions]).toEqual([])

    activeSessions = { s_live: {} }
    emitState("connected")
    await flush()
    expect([...provider.busySessions]).toEqual(["s_live"])

    // Disposing the panel interrupts only the session that is still actually busy.
    panel.fireDispose()
    await flush()
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(interrupt).toHaveBeenCalledWith({ sessionID: "s_live" })

    await provider.dispose()
  })

  it("clears naming busy state on disconnect and reconciles it on reconnect through AgentManagerProvider", async () => {
    let state: ConnectionState = "connected"
    let activeSessions: Record<string, unknown> = {}
    const stateListeners: Array<(status: ConnectionState) => void> = []

    const client = {
      session: {
        interrupt: async () => true,
        active: async () => activeSessions,
        list: async () => ({ data: [] }),
      },
      permission: { request: { list: async () => ({ data: [] }) } },
      form: { list: async () => ({ data: [] }) },
    }
    const connection = {
      client: async () => client,
      current: () => (state === "disconnected" ? undefined : client),
      state: () => state,
      onState: (listener: (next: ConnectionState) => void) => {
        stateListeners.push(listener)
        return () => undefined
      },
      onEvent: () => () => undefined,
      server: () => undefined,
      view: () => undefined,
      started: () => undefined,
      stopped: () => undefined,
      dispose: () => undefined,
    } as unknown as AgentManagerConnection

    const provider = new AgentManagerProvider(fakeHost(), connection, {
      open: () => fakePanel(),
      restore: () => fakePanel(),
    } as never)

    let clearCalls = 0
    const reconciled: string[][] = []
    const origClear = provider.naming.clearBusy.bind(provider.naming)
    const origReconcile = provider.naming.reconcileBusy.bind(provider.naming)
    provider.naming.clearBusy = () => {
      clearCalls++
      origClear()
    }
    provider.naming.reconcileBusy = (active) => {
      reconciled.push([...active].sort())
      origReconcile(active)
    }

    const emitState = (next: ConnectionState) => {
      state = next
      stateListeners.forEach((listener) => listener(next))
    }

    emitState("disconnected")
    expect(clearCalls).toBe(1)

    activeSessions = { s_active: {} }
    emitState("connected")
    await flush()
    expect(reconciled).toEqual([["s_active"]])

    await provider.dispose()
  })
})
