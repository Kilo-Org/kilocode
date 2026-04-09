import { describe, it, expect } from "bun:test"
import { loadSessions, flushPendingSessionRefresh, type SessionRefreshContext } from "../../src/kilo-provider-utils"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type State = "connecting" | "connected" | "disconnected" | "error"

type ProviderInternals = {
  connectionState: State
  pendingSessionRefresh: boolean
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  initializeConnection: () => Promise<void>
  handleLoadSessions: () => Promise<void>
}

function createContext(overrides?: Partial<SessionRefreshContext>): SessionRefreshContext & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    pendingSessionRefresh: false,
    connectionState: "connecting",
    listSessions: null,
    sessionDirectories: new Map(),
    workspaceDirectory: "/repo",
    postMessage: (msg: unknown) => sent.push(msg),
    sent,
    ...overrides,
  }
}

function createListSessions() {
  const calls: string[] = []
  const fn = async (dir: string) => {
    calls.push(dir)
    return []
  }
  return { calls, fn }
}

function createClient() {
  const calls: string[] = []
  return {
    calls,
    session: {
      list: async (params: { directory: string }) => {
        calls.push(params.directory)
        return { data: [] }
      },
    },
    provider: {
      list: async () => ({ data: { all: [], connected: {}, default: {} } }),
    },
    app: {
      agents: async () => ({ data: [] }),
    },
    config: {
      get: async () => ({ data: {} }),
    },
    kilo: {
      notifications: async () => ({ data: [] }),
      profile: async () => ({ data: {} }),
    },
  }
}

function createConnection(client: ReturnType<typeof createClient>) {
  let current: ReturnType<typeof createClient> | null = null
  return {
    connect: async () => {
      current = client
    },
    getClient: () => {
      if (!current) {
        throw new Error("Not connected")
      }
      return current
    },
    onEventFiltered: () => () => undefined,
    onStateChange: (_listener: (state: State) => void) => () => undefined,
    onNotificationDismissed: () => () => undefined,
    onLanguageChanged: () => () => undefined,
    onProfileChanged: () => () => undefined,
    onMigrationComplete: () => () => undefined,
    onFavoritesChanged: () => () => undefined,
    onClearPendingPrompts: () => () => undefined,
    registerDirectoryProvider: () => () => undefined,
    getServerInfo: () => ({ port: 12345 }),
    getConnectionState: () => "connected" as const,
    resolveEventSessionId: () => undefined,
    recordMessageSessionId: () => undefined,
    notifyNotificationDismissed: () => undefined,
  }
}

describe("KiloProvider pending session refresh", () => {
  it("flushes deferred refresh via flushPendingSessionRefresh", async () => {
    const { calls, fn } = createListSessions()
    const ctx = createContext()
    ctx.sessionDirectories.set("ses_1", "/worktree")

    await loadSessions(ctx)
    expect(ctx.pendingSessionRefresh).toBe(true)

    ctx.listSessions = fn
    ctx.connectionState = "connected"

    await flushPendingSessionRefresh(ctx)

    expect(calls).toEqual(["/repo", "/worktree"])
    expect(ctx.pendingSessionRefresh).toBe(false)
  })

  it("flushes deferred refresh in initializeConnection without relying on connected event callback", async () => {
    const client = createClient()
    const connection = createConnection(client)
    const provider = new KiloProvider({} as never, connection as never)
    const internal = provider as unknown as ProviderInternals

    provider.setSessionDirectory("ses_1", "/worktree")

    await internal.handleLoadSessions()
    expect(internal.pendingSessionRefresh).toBe(true)

    await internal.initializeConnection()

    expect(client.calls).toEqual(["/repo", "/worktree"])
    expect(internal.pendingSessionRefresh).toBe(false)
  })

  it("does not post not-connected errors while still connecting", async () => {
    const client = createClient()
    const connection = createConnection(client)
    const provider = new KiloProvider({} as never, connection as never)
    const internal = provider as unknown as ProviderInternals
    const sent: unknown[] = []

    internal.webview = {
      postMessage: async (message: unknown) => {
        sent.push(message)
      },
    }

    internal.connectionState = "connecting"
    await internal.handleLoadSessions()

    const errors = sent.filter((msg) => {
      if (typeof msg !== "object" || !msg) {
        return false
      }

      return "type" in msg && (msg as { type?: unknown }).type === "error"
    })

    expect(errors).toEqual([])
  })
})
