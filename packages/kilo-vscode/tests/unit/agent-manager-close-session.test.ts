import { describe, expect, it, mock } from "bun:test"

const { AgentManagerProvider } = await import("../../src/agent-manager/AgentManagerProvider")

type Manager = {
  connectionService: { getClient: () => unknown }
  panel: {
    sessions: {
      getSessionDirectories: () => ReadonlyMap<string, string>
      clearSessionDirectory: (id: string) => void
    }
  }
  getStateManager: () => unknown
  getRoot: () => string
  pushState: () => void
  log: (...args: unknown[]) => void
  onCloseSession: (sessionId: string) => Promise<null>
}

function createManager(options?: { dir?: string; panelDir?: string }) {
  const stopped: unknown[] = []
  const cleared: string[] = []
  const removed: string[] = []
  const client = {
    backgroundProcess: {
      stopSession: mock(async (params: unknown) => {
        stopped.push(params)
        return { data: {} }
      }),
    },
  }
  const state = {
    directoryFor: mock((sessionId: string) => (sessionId === "s1" ? options?.dir : undefined)),
    removeSession: mock((sessionId: string) => {
      removed.push(sessionId)
    }),
  }
  const manager = Object.create(AgentManagerProvider.prototype) as Manager
  manager.connectionService = { getClient: () => client }
  manager.panel = {
    sessions: {
      getSessionDirectories: () => new Map(options?.panelDir ? [["s1", options.panelDir]] : []),
      clearSessionDirectory: (id) => cleared.push(id),
    },
  }
  manager.getStateManager = () => state
  manager.getRoot = () => "/repo"
  manager.pushState = mock(() => undefined)
  manager.log = mock(() => undefined)

  return { manager, stopped, cleared, removed }
}

describe("AgentManagerProvider closeSession", () => {
  it("stops background processes in the worktree directory before closing", async () => {
    const { manager, stopped, cleared, removed } = createManager({ dir: "/repo/worktree" })

    await manager.onCloseSession("s1")

    expect(stopped).toEqual([{ sessionID: "s1", directory: "/repo/worktree" }])
    expect(removed).toEqual(["s1"])
    expect(cleared).toEqual(["s1"])
  })

  it("falls back to session provider directory mappings", async () => {
    const { manager, stopped } = createManager({ panelDir: "/repo/panel-worktree" })

    await manager.onCloseSession("s1")

    expect(stopped).toEqual([{ sessionID: "s1", directory: "/repo/panel-worktree" }])
  })
})
