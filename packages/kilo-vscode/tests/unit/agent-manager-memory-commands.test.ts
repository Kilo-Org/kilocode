import { describe, expect, it, mock } from "bun:test"

const { AgentManagerProvider } = await import("../../src/agent-manager/AgentManagerProvider")

type Manager = {
  host: { showError: (message: string) => void }
  panel:
    | {
        waitForReady: () => Promise<void>
        onDidDispose: (cb: () => void) => { dispose: () => void }
        sessions: {
          showMemory: (sessionID?: string) => Promise<void>
          toggleMemory: (sessionID?: string) => Promise<void>
        }
      }
    | undefined
  activeSessionId: string | undefined
  showMemory: () => Promise<void>
  toggleMemory: () => Promise<void>
}

function deferred() {
  let done: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    done = resolve
  })
  return {
    promise,
    resolve: () => done?.(),
  }
}

function manager() {
  const calls: unknown[] = []
  const disposers: Array<() => void> = []
  const item = Object.create(AgentManagerProvider.prototype) as Manager
  item.host = { showError: mock((message) => calls.push(["error", message])) }
  item.panel = {
    waitForReady: mock(async () => calls.push("ready")),
    onDidDispose: mock((cb) => {
      disposers.push(cb)
      return { dispose: mock(() => {}) }
    }),
    sessions: {
      showMemory: mock(async (sessionID) => calls.push(["show", sessionID])),
      toggleMemory: mock(async (sessionID) => calls.push(["toggle", sessionID])),
    },
  }
  item.activeSessionId = "ses_agent_manager"
  return {
    item,
    calls,
    dispose: () => {
      for (const cb of disposers) cb()
    },
  }
}

describe("AgentManagerProvider memory commands", () => {
  it("routes memory commands to the active Agent Manager session", async () => {
    const ctx = manager()

    await ctx.item.showMemory()
    await ctx.item.toggleMemory()

    expect(ctx.calls).toEqual(["ready", ["show", "ses_agent_manager"], "ready", ["toggle", "ses_agent_manager"]])
  })

  it("does not fall back when Agent Manager has no active session", async () => {
    const ctx = manager()
    ctx.item.activeSessionId = undefined

    await ctx.item.showMemory()

    expect(ctx.calls).toEqual([["error", "No active Agent Manager session"]])
  })

  it("does not hang when the panel is disposed before it is ready", async () => {
    const ctx = manager()
    const wait = deferred()
    ctx.item.panel!.waitForReady = mock(() => wait.promise)

    const pending = ctx.item.showMemory()
    ctx.dispose()
    await pending

    expect(ctx.calls).toEqual([])
  })

  it("does not target a stale session after readiness resolves", async () => {
    const ctx = manager()
    const wait = deferred()
    ctx.item.panel!.waitForReady = mock(() => wait.promise)

    const pending = ctx.item.toggleMemory()
    ctx.item.activeSessionId = "ses_other"
    wait.resolve()
    await pending

    expect(ctx.calls).toEqual([])
  })
})
