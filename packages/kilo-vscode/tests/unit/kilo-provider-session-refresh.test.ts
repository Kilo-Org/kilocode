import { describe, it, expect } from "bun:test"
import { loadSessions, flushPendingSessionRefresh, type SessionRefreshContext } from "../../src/kilo-provider-utils"

function createContext(overrides?: Partial<SessionRefreshContext>): SessionRefreshContext & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    pendingSessionRefresh: false,
    connectionState: "connecting",
    httpClient: null,
    sessionDirectories: new Map(),
    workspaceDirectory: "/repo",
    postMessage: (msg: unknown) => sent.push(msg),
    sent,
    ...overrides,
  }
}

function createClient() {
  const calls: string[] = []
  return {
    calls,
    listSessions: async (dir: string) => {
      calls.push(dir)
      return []
    },
  }
}

describe("KiloProvider pending session refresh", () => {
  it("flushes deferred refresh via flushPendingSessionRefresh", async () => {
    const client = createClient()
    const ctx = createContext()
    ctx.sessionDirectories.set("ses_1", "/worktree")

    // httpClient is null → loadSessions sets pendingSessionRefresh
    await loadSessions(ctx)
    expect(ctx.pendingSessionRefresh).toBe(true)

    // Make the httpClient available
    ctx.httpClient = client
    ctx.connectionState = "connected"

    // flushPendingSessionRefresh retries loadSessions when pending
    await flushPendingSessionRefresh(ctx)

    expect(client.calls).toEqual(["/repo", "/worktree"])
    expect(ctx.pendingSessionRefresh).toBe(false)
  })

  it("does not post not-connected errors while still connecting", async () => {
    const ctx = createContext({ connectionState: "connecting" })

    await loadSessions(ctx)

    const errors = ctx.sent.filter((msg) => {
      if (typeof msg !== "object" || !msg) return false
      return "type" in msg && (msg as { type?: unknown }).type === "error"
    })

    expect(errors).toEqual([])
  })
})
