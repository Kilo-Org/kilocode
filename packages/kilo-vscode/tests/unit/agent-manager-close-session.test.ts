import { describe, expect, it, mock } from "bun:test"

const { AgentManagerProvider } = await import("../../src/agent-manager/AgentManagerProvider")

type Manager = {
  connectionService: { getClient: () => unknown }
  panel: {
    postMessage: (message: unknown) => void
    sessions: {
      getSessionDirectories: () => ReadonlyMap<string, string>
      clearSessionDirectory: (id: string) => void
      abortSessions: (ids: readonly string[]) => Promise<void>
    }
  }
  panelSessions: Set<string>
  getStateManager: () => unknown
  getRoot: () => string
  pushState: () => void
  log: (...args: unknown[]) => void
  onCloseSession: (sessionId: string) => Promise<null>
}

function createManager(options?: { dir?: string; panelDir?: string; state?: boolean }) {
  const stopped: unknown[] = []
  const aborted: string[][] = []
  const cleared: string[] = []
  const removed: string[] = []
  const messages: unknown[] = []
  const events: string[] = []
  const client = {
    backgroundProcess: {
      stopSession: mock(async (params: unknown) => {
        stopped.push(params)
        events.push("processes")
        return { data: {} }
      }),
    },
  }
  const state = {
    directoryFor: mock((sessionId: string) => (sessionId === "s1" ? options?.dir : undefined)),
    removeSession: mock((sessionId: string) => {
      removed.push(sessionId)
      events.push("remove")
    }),
  }
  const manager = Object.create(AgentManagerProvider.prototype) as Manager
  manager.connectionService = { getClient: () => client }
  manager.panel = {
    postMessage: (message) => messages.push(message),
    sessions: {
      getSessionDirectories: () => new Map(options?.panelDir ? [["s1", options.panelDir]] : []),
      clearSessionDirectory: (id) => cleared.push(id),
      abortSessions: async (ids) => {
        aborted.push([...ids])
        events.push("abort")
      },
    },
  }
  manager.panelSessions = new Set(["s1"])
  manager.getStateManager = () => (options?.state === false ? undefined : state)
  manager.getRoot = () => "/repo"
  manager.pushState = mock(() => undefined)
  manager.log = mock(() => undefined)

  return { manager, stopped, aborted, cleared, removed, messages, events }
}

describe("AgentManagerProvider closeSession", () => {
  it("aborts the agent before stopping processes and removing its tab", async () => {
    const { manager, stopped, aborted, cleared, removed, messages, events } = createManager({ dir: "/repo/worktree" })

    await manager.onCloseSession("s1")

    expect(aborted).toEqual([["s1"]])
    expect(stopped).toEqual([{ sessionID: "s1", directory: "/repo/worktree" }])
    expect(events).toEqual(["abort", "processes", "remove"])
    expect(removed).toEqual(["s1"])
    expect(cleared).toEqual(["s1"])
    expect(messages).toEqual([])
    expect(manager.panelSessions.has("s1")).toBe(false)
  })

  it("falls back to session provider directory mappings", async () => {
    const { manager, stopped } = createManager({ panelDir: "/repo/panel-worktree" })

    await manager.onCloseSession("s1")

    expect(stopped).toEqual([{ sessionID: "s1", directory: "/repo/panel-worktree" }])
  })

  it("still aborts when Agent Manager has no workspace state", async () => {
    const { manager, aborted, removed } = createManager({ state: false })

    await manager.onCloseSession("s1")

    expect(aborted).toEqual([["s1"]])
    expect(removed).toEqual([])
  })
})
