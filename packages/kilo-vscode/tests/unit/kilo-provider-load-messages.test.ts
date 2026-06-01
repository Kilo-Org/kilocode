import { describe, it, expect } from "bun:test"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type State = "connecting" | "connected" | "disconnected" | "error"

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mkMessage(id: string, role: "user" | "assistant", time = 0) {
  return {
    info: {
      id,
      sessionID: "s1",
      role,
      time: { created: time },
    },
    parts: [],
  }
}

function mkResult(items: unknown[]) {
  return { data: items, response: { headers: new Headers() } }
}

function createClient(options?: {
  messagesDeferred?: Deferred<{ data: unknown[]; response: { headers: Headers } }>
  messagesData?: unknown[]
  deleteDeferred?: Deferred<unknown>
  sessionData?: unknown
  sessionGet?: (params: { sessionID: string; directory?: string }) => Promise<{ data: unknown }>
}) {
  const calls: { before?: string; limit?: number }[] = []
  const stopped: { sessionID: string; directory?: string }[] = []
  return {
    calls,
    stopped,
    session: {
      list: async () => ({ data: [] }),
      get: async (params: { sessionID: string; directory?: string }) => {
        if (options?.sessionGet) return options.sessionGet(params)
        return { data: options?.sessionData ?? null }
      },
      status: async () => ({ data: {} }),
      messages: async (params: { before?: string; limit?: number }) => {
        calls.push({ before: params.before, limit: params.limit })
        if (options?.messagesDeferred) return options.messagesDeferred.promise
        return mkResult(options?.messagesData ?? [])
      },
      delete: async () => {
        if (options?.deleteDeferred) return options.deleteDeferred.promise
        return { data: {} }
      },
    },
    backgroundProcess: {
      stopSession: async (params: { sessionID: string; directory?: string }) => {
        stopped.push(params)
        return { data: {} }
      },
    },
    provider: { list: async () => ({ data: { all: [], connected: {}, default: {} } }) },
    app: { agents: async () => ({ data: [] }) },
    config: { get: async () => ({ data: {} }) },
    kilo: {
      notifications: async () => ({ data: [] }),
      profile: async () => ({ data: {} }),
    },
    command: { list: async () => ({ data: [] }) },
  }
}

function createConnection(client: ReturnType<typeof createClient>) {
  return {
    connect: async () => {},
    getClient: () => client,
    onEventFiltered: () => () => undefined,
    onStateChange: (_l: (s: State) => void) => () => undefined,
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
    pruneSession: () => undefined,
    registerFocused: () => undefined,
    unregisterFocused: () => undefined,
  }
}

type ProviderInternals = {
  connectionState: State
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  currentSession: { id: string; directory?: string } | null
  contextSessionID: string | undefined
  sessionDirectories: Map<string, string>
  trackedSessionIds: Set<string>
  stopCurrentSessionProcesses: (next?: string) => void
  handleLoadMessages: (sid: string, opts?: { mode?: string; before?: string; limit?: number }) => Promise<void>
  handleDeleteSession: (sid: string) => Promise<void>
}

function makeProvider(client: ReturnType<typeof createClient>) {
  const connection = createConnection(client)
  const provider = new KiloProvider({} as never, connection as never)
  const internal = provider as unknown as ProviderInternals
  internal.connectionState = "connected"
  const sent: unknown[] = []
  internal.webview = {
    postMessage: async (message: unknown) => {
      sent.push(message)
    },
  }
  return { provider, internal, sent }
}

describe("KiloProvider.handleLoadMessages / focus mode freshness", () => {
  it("stops background processes for the previous session when switching sessions", async () => {
    const client = createClient({
      sessionData: { id: "s2", directory: "/repo/worktree", time: { created: 1, updated: 1 } },
    })
    const { internal } = makeProvider(client)
    internal.currentSession = { id: "s1", directory: "/repo/old" }

    await internal.handleLoadMessages("s2")

    expect(client.stopped).toEqual([{ sessionID: "s1", directory: "/repo/old" }])
  })

  it("does not stop background processes twice for focus-mode reconcile", async () => {
    const client = createClient({ messagesData: [mkMessage("m1", "user", 1)] })
    const { internal } = makeProvider(client)
    internal.currentSession = { id: "s1", directory: "/repo/old" }

    await internal.handleLoadMessages("s2", { mode: "focus" })

    expect(client.stopped).toEqual([{ sessionID: "s1", directory: "/repo/old" }])
  })

  it("ignores stale focus refreshes after switching sessions", async () => {
    const s1 = defer<{ data: unknown }>()
    const s2 = defer<{ data: unknown }>()
    const client = createClient({
      sessionGet: async (params) => {
        if (params.sessionID === "s1") return s1.promise
        if (params.sessionID === "s2") return s2.promise
        return { data: null }
      },
    })
    const { internal } = makeProvider(client)
    internal.currentSession = { id: "s1", directory: "/repo/old" }
    internal.trackedSessionIds.add("s1")

    await internal.handleLoadMessages("s1", { mode: "focus" })
    const load = internal.handleLoadMessages("s2")
    s2.resolve({ data: { id: "s2", directory: "/repo/new", time: { created: 2, updated: 2 } } })
    await load
    await Promise.resolve()
    expect(internal.currentSession?.id).toBe("s2")

    s1.resolve({ data: { id: "s1", directory: "/repo/old", time: { created: 1, updated: 1 } } })
    await Promise.resolve()

    expect(internal.currentSession?.id).toBe("s2")
    expect(client.stopped).toEqual([{ sessionID: "s1", directory: "/repo/old" }])
  })

  it("stops each synchronously selected session during rapid switches", async () => {
    const messages = defer<{ data: unknown[]; response: { headers: Headers } }>()
    const client = createClient({ messagesDeferred: messages })
    const { internal } = makeProvider(client)
    internal.currentSession = { id: "s1", directory: "/repo/s1" }
    internal.contextSessionID = "s1"
    internal.sessionDirectories.set("s2", "/repo/s2")

    const s2 = internal.handleLoadMessages("s2")
    const s3 = internal.handleLoadMessages("s3")

    expect(client.stopped).toEqual([
      { sessionID: "s1", directory: "/repo/s1" },
      { sessionID: "s2", directory: "/repo/s2" },
    ])

    messages.resolve(mkResult([]))
    await Promise.all([s2, s3])
  })

  it("stops the selected visible session when clearSession runs with stale currentSession", async () => {
    const client = createClient()
    const { internal } = makeProvider(client)
    internal.currentSession = { id: "s1", directory: "/repo/s1" }
    internal.contextSessionID = "s2"
    internal.sessionDirectories.set("s2", "/repo/s2")

    internal.stopCurrentSessionProcesses()
    internal.contextSessionID = undefined
    internal.currentSession = null

    expect(client.stopped).toEqual([{ sessionID: "s2", directory: "/repo/s2" }])
  })

  it("refetches the tail page on focus-mode reselection and posts a reconcile snapshot", async () => {
    // Regression: switching to an already-loaded session sent mode: "focus"
    // which only refreshed session metadata and status — not messages. If
    // SSE dropped events during the gap (reconnect, missed child-task
    // messages, backend crash-restart) the webview showed stale content with
    // no way to recover short of reloading the extension. Focus mode must
    // still reconcile the tail against the server snapshot so silent drift
    // self-heals on the next session switch.
    const messages = [
      mkMessage("m1", "user", 1),
      mkMessage("m2", "assistant", 2),
      mkMessage("m3", "user", 3), // delivered after SSE reconnect, missed by webview
    ]
    const client = createClient({ messagesData: messages })
    const { internal, sent } = makeProvider(client)
    internal.trackedSessionIds.add("s1")

    await internal.handleLoadMessages("s1", { mode: "focus" })

    // Server must be hit to reconcile the current state.
    expect(client.calls.length).toBeGreaterThanOrEqual(1)

    // Must post a messagesLoaded snapshot tagged reconcile — not replace —
    // so the webview merges without tearing down existing reactive proxies.
    const loaded = sent.find(
      (msg) => typeof msg === "object" && msg && (msg as { type?: unknown }).type === "messagesLoaded",
    ) as { mode?: string; since?: number; messages: { id: string }[] } | undefined
    expect(loaded).toBeDefined()
    expect(loaded!.mode).toBe("reconcile")
    expect(typeof loaded!.since).toBe("number")
    expect(loaded!.messages.map((m) => m.id)).toContain("m3")
  })

  it("throttles repeat focus-mode reconciles within 1s", async () => {
    // Regression: rapid session tab switching (A→B→A) used to stack up one
    // reconcile fetch per click, each doing a full-page fetch + 80-message
    // reactive-store reconcile. A 1s throttle kills the redundant work while
    // still catching SSE drops on normal use patterns.
    const client = createClient({ messagesData: [mkMessage("m1", "user", 1)] })
    const { internal } = makeProvider(client)
    internal.trackedSessionIds.add("s1")

    await internal.handleLoadMessages("s1", { mode: "focus" })
    const callsAfterFirst = client.calls.length

    // Second focus within the throttle window — no fetch should happen.
    await internal.handleLoadMessages("s1", { mode: "focus" })
    expect(client.calls.length).toBe(callsAfterFirst)
  })

  it("does not post messagesLoaded on focus when the session is no longer tracked", async () => {
    // Defensive: if the user deletes the session while the background focus
    // refetch is in flight, drop the response (same invariant as prepend).
    const messages = defer<{ data: unknown[]; response: { headers: Headers } }>()
    const client = createClient({ messagesDeferred: messages })
    const { internal, sent } = makeProvider(client)
    internal.trackedSessionIds.add("s1")

    const load = internal.handleLoadMessages("s1", { mode: "focus" })
    await internal.handleDeleteSession("s1")
    messages.resolve(mkResult([mkMessage("m1", "user", 10)]))
    await load

    const loaded = sent.filter(
      (msg) => typeof msg === "object" && msg && (msg as { type?: unknown }).type === "messagesLoaded",
    )
    expect(loaded).toEqual([])
    expect(client.stopped).toEqual([{ sessionID: "s1", directory: "/repo" }])
  })
})

describe("KiloProvider.handleDeleteSession / background processes", () => {
  it("stops session background processes in the session directory before deletion", async () => {
    const client = createClient()
    const { internal } = makeProvider(client)
    internal.sessionDirectories.set("s1", "/repo/worktree")

    await internal.handleDeleteSession("s1")

    expect(client.stopped).toEqual([{ sessionID: "s1", directory: "/repo/worktree" }])
  })
})

describe("KiloProvider.loadMessages / sub-agent viewer full history", () => {
  it("loads all messages without the MESSAGE_PAGE_LIMIT cap (sub-agent viewer needs full turn history)", async () => {
    // Regression: SubAgentViewerProvider used to call client.session.messages
    // with no limit, loading every turn. After switching to provider.loadMessages
    // it inherited the 80-message page cap and sub-agents with more than 80
    // turns would open truncated with no visible indicator. loadMessages() is
    // the sub-agent viewer's single entry point — it must request the full
    // transcript.
    const big = Array.from({ length: 200 }, (_, i) => mkMessage(`m${i}`, i % 2 === 0 ? "user" : "assistant", i))
    const client = createClient({ messagesData: big })
    const { provider, sent } = makeProvider(client)

    await provider.loadMessages("s1")

    const loaded = sent.find(
      (msg) => typeof msg === "object" && msg && (msg as { type?: unknown }).type === "messagesLoaded",
    ) as { messages: unknown[] } | undefined
    expect(loaded).toBeDefined()
    expect(loaded!.messages).toHaveLength(200)

    // Server contract: limit: 0 (or undefined) returns everything.
    expect(client.calls).toHaveLength(1)
    const limit = client.calls[0]?.limit
    expect(limit === undefined || limit === 0).toBe(true)
  })
})

describe("KiloProvider.handleLoadMessages / prepend into deleted session", () => {
  it("does not post messagesLoaded for a session deleted mid-prepend", async () => {
    // Regression: handleLoadMessages fires fire-and-forget from the webview
    // message dispatcher. If the user deletes the session while a prepend
    // fetch is in flight, the response still arrives and posts messagesLoaded
    // for a now-dead session ID, resurrecting a ghost entry in the webview
    // store until something else clears it.
    const messages = defer<{ data: unknown[]; response: { headers: Headers } }>()
    const client = createClient({ messagesDeferred: messages })
    const { internal, sent } = makeProvider(client)

    // Simulate the session being tracked (as it would after the initial load).
    internal.trackedSessionIds.add("s1")

    const load = internal.handleLoadMessages("s1", { mode: "prepend", before: "cursor-1", limit: 80 })

    // User deletes the session while the fetch is still pending.
    await internal.handleDeleteSession("s1")

    // Fetch finally resolves after deletion.
    messages.resolve(mkResult([mkMessage("m1", "user", 10)]))
    await load

    const loaded = sent.filter(
      (msg) => typeof msg === "object" && msg && (msg as { type?: unknown }).type === "messagesLoaded",
    )
    expect(loaded).toEqual([])
  })
})
