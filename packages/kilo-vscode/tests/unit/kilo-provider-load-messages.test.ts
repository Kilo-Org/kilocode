import { describe, it, expect, spyOn } from "bun:test"
import * as vscode from "vscode"
import type { PartUpdate } from "../../src/shared/stream-messages"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider, unwrapSyncEvent } = await import("../../src/KiloProvider")

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

function mkSession(revert?: { messageID: string }) {
  return {
    id: "s1",
    slug: "session",
    version: "1",
    projectID: "project",
    directory: "/repo",
    title: "Session",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    revert,
  }
}

function mkResult(items: unknown[]) {
  return { data: items, response: { headers: new Headers() } }
}

function mkCreatedSession(id = "created") {
  return { id, title: "Created", time: { created: 0, updated: 0 } }
}

function createClient(options?: {
  messagesDeferred?: Deferred<{ data: unknown[]; response: { headers: Headers } }>
  messagesData?: unknown[]
  deleteDeferred?: Deferred<unknown>
  revertDeferred?: Deferred<{ data?: unknown; error?: unknown }>
  sessionData?: unknown
  sessionGet?: (params: { sessionID: string; directory?: string }) => Promise<{ data: unknown }>
  createDeferred?: Deferred<{ data: ReturnType<typeof mkCreatedSession> }>
  abortFailures?: string[]
  abortDeferred?: Deferred<void>
  supportDeferred?: Deferred<{ data: { available: boolean; reason?: string } }>
  sandboxDeferred?: Deferred<{ data: unknown }>
  sandboxStarted?: Deferred<void>
  createSession?: (params: Record<string, unknown>, index: number) => Promise<{ data: unknown }>
}) {
  const calls: { before?: string; limit?: number }[] = []
  const stopped: { sessionID: string; directory?: string }[] = []
  const aborted: { sessionID: string; directory?: string }[] = []
  const deleted: { sessionID: string; directory?: string }[] = []
  const prompted: Array<Record<string, unknown>> = []
  const reverted: Array<Record<string, unknown>> = []
  const created: Array<Record<string, unknown>> = []
  const sandboxed: Array<Record<string, unknown>> = []
  const sandboxSupport: Array<Record<string, unknown>> = []
  const configReads: Array<Record<string, unknown>> = []
  return {
    calls,
    stopped,
    aborted,
    deleted,
    prompted,
    reverted,
    created,
    sandboxed,
    sandboxSupport,
    configReads,
    session: {
      list: async () => ({ data: [] }),
      create: async (params: Record<string, unknown>) => {
        created.push(params)
        if (options?.createSession) return options.createSession(params, created.length - 1)
        return options?.createDeferred?.promise ?? { data: mkCreatedSession() }
      },
      get: async (params: { sessionID: string; directory?: string }) => {
        if (options?.sessionGet) return options.sessionGet(params)
        return { data: options?.sessionData ?? null }
      },
      status: async () => ({ data: {} }),
      revert: async (params: Record<string, unknown>) => {
        reverted.push(params)
        if (options?.revertDeferred) return options.revertDeferred.promise
        return { data: mkSession({ messageID: String(params.messageID) }) }
      },
      promptAsync: async (params: Record<string, unknown>) => {
        prompted.push(params)
        return { data: undefined }
      },
      abort: async (params: { sessionID: string; directory?: string }) => {
        aborted.push(params)
        if (params.directory && options?.abortFailures?.includes(params.directory)) throw new Error("abort failed")
        await options?.abortDeferred?.promise
        return { data: true }
      },
      messages: async (params: { before?: string; limit?: number }) => {
        calls.push({ before: params.before, limit: params.limit })
        if (options?.messagesDeferred) return options.messagesDeferred.promise
        return mkResult(options?.messagesData ?? [])
      },
      delete: async (params: { sessionID: string; directory?: string }) => {
        deleted.push(params)
        if (options?.deleteDeferred) return options.deleteDeferred.promise
        return { data: {} }
      },
    },
    sandbox: {
      support: async (params: Record<string, unknown>) => {
        sandboxSupport.push(params)
        return options?.supportDeferred?.promise ?? { data: { available: true } }
      },
      toggle: async (params: Record<string, unknown>) => {
        sandboxed.push(params)
        options?.sandboxStarted?.resolve(undefined)
        return (
          options?.sandboxDeferred?.promise ?? {
            data: { directory: "/repo", enabled: true, available: true, version: 1 },
          }
        )
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
    config: {
      get: async (params: Record<string, unknown>) => {
        configReads.push(params)
        return { data: {} }
      },
    },
    kilo: {
      notifications: async () => ({ data: [] }),
      profile: async () => ({ data: {} }),
    },
    command: { list: async () => ({ data: [] }) },
  }
}

function createConnection(client: ReturnType<typeof createClient>) {
  const state = { value: undefined as boolean | undefined, revision: 0, pending: Promise.resolve() }
  return {
    sandboxPreference: {
      explicit: () => state.value,
      resolve: (fallback: boolean) => state.value ?? fallback,
      wait: () => state.pending,
      set: (enabled: boolean, validate?: () => Promise<void>) => {
        const update = state.pending
          .catch(() => undefined)
          .then(async () => {
            await validate?.()
            state.value = enabled
            state.revision += 1
          })
        state.pending = update
        return update
      },
      onChange: () => () => undefined,
    },
    connect: async () => {},
    getClient: () => client,
    onEventFiltered: () => () => undefined,
    onStateChange: (_l: (s: State) => void) => () => undefined,
    onNotificationDismissed: () => () => undefined,
    onLanguageChanged: () => () => undefined,
    onProfileChanged: () => () => undefined,
    onMigrationComplete: () => () => undefined,
    onFavoritesChanged: () => () => undefined,
    onModelSelectorExpandedChanged: () => () => undefined,
    onClearPendingPrompts: () => () => undefined,
    registerDirectoryProvider: () => () => undefined,
    getServerInfo: () => ({ port: 12345 }),
    getConnectionState: () => "connected" as const,
    getConnectionError: () => null,
    resolveEventSessionId: () => undefined,
    recordMessageSessionId: () => undefined,
    notifyNotificationDismissed: () => undefined,
    pruneSession: () => undefined,
    registerVisible: () => undefined,
    unregisterVisible: () => undefined,
    registerAttached: () => undefined,
    unregisterAttached: () => undefined,
  }
}

type ProviderInternals = {
  connectionState: State
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  currentSession: { id: string; directory?: string; cost?: number; revert?: { messageID: string } } | null
  contextSessionID: string | undefined
  sessionDirectories: Map<string, string>
  trackedSessionIds: Set<string>
  openSessionIds: Set<string>
  draftSessions: Map<string, { sid: string; dir: string; expires: number }>
  checkpoints: Map<string, Promise<void>>
  revisions: Map<string, { id: string; seq: number }>
  streams: { push: (msg: PartUpdate) => void }
  checkpoint: (sid: string, run: () => Promise<void>) => void
  gatherEditorContext: () => Promise<Record<string, never>>
  refreshSessionDetails: (sid: string, dir: string) => void
  stopCurrentSessionProcesses: (next?: string) => void
  handleEvent: (event: unknown, directory?: string) => void
  handleAbort: (sid?: string) => Promise<void>
  resolveSession: (sid?: string, draft?: string, context?: string, dir?: string) => Promise<unknown>
  handleCostAlertResponse: (sid: string, limit: number, response: "continue" | "stop") => Promise<void>
  setMaxCost: (value: unknown) => void
  handleRevertSession: (sid: string, messageID: string) => Promise<void>
  handleSendMessage: (text: string, messageID?: string, sessionID?: string, draftID?: string) => Promise<void>
  trackOpenSessions: (ids: string[]) => void
  fetchAndSendSandboxDefault: (directory?: string, requestID?: string) => Promise<void>
  handleSetSandboxDefault: (enabled: boolean, requestID: string, directory?: string) => Promise<void>
  handleToggleSandbox: (input: { sessionID: string; requestID: string }) => Promise<void>
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

function mockMaxCost(internal: ProviderInternals, value: number) {
  internal.setMaxCost(value)
}

describe("KiloProvider.handleAbort", () => {
  it("aborts the original owner after a running session moves to a worktree", async () => {
    const client = createClient()
    const { provider, internal, sent } = makeProvider(client)
    internal.handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "s1", status: { type: "busy" } },
      },
      "/repo",
    )
    provider.setSessionDirectory("s1", "/repo/worktree")

    await internal.handleAbort("s1")

    expect(client.aborted).toEqual([
      { sessionID: "s1", directory: "/repo" },
      { sessionID: "s1", directory: "/repo/worktree" },
    ])
    expect(sent.at(-1)).toMatchObject({ type: "sessionStatus", sessionID: "s1", status: "idle" })
  })

  it("preserves the original owner when the status event lacks a directory", async () => {
    const client = createClient()
    const { provider, internal } = makeProvider(client)
    internal.handleEvent({
      type: "session.status",
      properties: { sessionID: "s1", status: { type: "busy" } },
    })
    provider.setSessionDirectory("s1", "/repo/worktree")

    await internal.handleAbort("s1")

    expect(client.aborted).toEqual([
      { sessionID: "s1", directory: "/repo" },
      { sessionID: "s1", directory: "/repo/worktree" },
    ])
  })

  it("attempts every owner and stays busy when one abort fails", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const client = createClient({ abortFailures: ["/repo"] })
    const { provider, internal, sent } = makeProvider(client)
    internal.handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "s1", status: { type: "busy" } },
      },
      "/repo",
    )
    provider.setSessionDirectory("s1", "/repo/worktree")

    await internal.handleAbort("s1")

    expect(client.aborted).toEqual([
      { sessionID: "s1", directory: "/repo" },
      { sessionID: "s1", directory: "/repo/worktree" },
    ])
    expect(sent.at(-1)).toMatchObject({ type: "sessionStatus", sessionID: "s1", status: "busy" })
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it("snapshots every session owner before provider disposal", async () => {
    const pending = defer<void>()
    const client = createClient({ abortDeferred: pending })
    const { provider, internal } = makeProvider(client)
    internal.handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "s1", status: { type: "busy" } },
      },
      "/repo",
    )
    provider.setSessionDirectory("s1", "/repo/worktree")
    provider.setSessionDirectory("s2", "/repo/other")

    const stopped = provider.abortSessions(["s1", "s2", "s2"])
    provider.dispose()

    expect(client.aborted).toEqual([
      { sessionID: "s1", directory: "/repo" },
      { sessionID: "s1", directory: "/repo/worktree" },
      { sessionID: "s2", directory: "/repo/other" },
    ])
    pending.resolve(undefined)
    await stopped
  })

  it("discards a session created after its pending tab closes", async () => {
    const created = defer<{ data: ReturnType<typeof mkCreatedSession> }>()
    const client = createClient({ createDeferred: created })
    const { provider, internal, sent } = makeProvider(client)

    const resolving = internal.resolveSession(undefined, "pending:1", "local")
    await provider.abortSessions(["pending:1"])
    created.resolve({ data: mkCreatedSession() })

    expect(await resolving).toBeUndefined()
    expect(client.deleted).toEqual([{ sessionID: "created", directory: "/repo" }])
    expect(sent).not.toContainEqual(expect.objectContaining({ type: "sessionCreated" }))
  })

  it("does not tombstone a pending tab that never started creating", async () => {
    const client = createClient()
    const { provider, internal } = makeProvider(client)

    await provider.abortSessions(["pending:1"])
    expect(await internal.resolveSession(undefined, "pending:1", "local")).toBeDefined()
    expect(client.deleted).toEqual([])
  })

  it("does not submit a prompt when its pending tab closes after creation", async () => {
    const context = defer<Record<string, never>>()
    const client = createClient()
    const { provider, internal, sent } = makeProvider(client)
    internal.gatherEditorContext = () => context.promise

    const sending = internal.handleSendMessage("hello", "msg-1", undefined, "pending:1")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent).toContainEqual(expect.objectContaining({ type: "sessionCreated" }))

    await provider.abortSessions(["pending:1"])
    context.resolve({})
    await sending

    expect(client.aborted).toEqual([{ sessionID: "created", directory: "/repo" }])
    expect(client.prompted).toEqual([])

    await provider.abortSessions(["pending:1"])
    expect(client.aborted).toHaveLength(1)
  })

  it("releases draft routing after the webview adopts the created session", async () => {
    const client = createClient()
    const { provider, internal } = makeProvider(client)

    expect(await internal.resolveSession(undefined, "pending:1", "local")).toBeDefined()
    provider.acknowledgeDraft("pending:1", "created")
    await provider.abortSessions(["pending:1"])

    expect(client.aborted).toEqual([])
  })
})

describe("KiloProvider sandbox status", () => {
  it("ignores events from another directory for the same session", () => {
    const client = createClient()
    const { internal, sent } = makeProvider(client)
    internal.sessionDirectories.set("s1", "/repo")
    internal.trackedSessionIds.add("s1")

    internal.handleEvent({
      type: "sandbox.status.changed",
      properties: { sessionID: "s1", directory: "/other", enabled: true, available: true, version: 1 },
    })
    expect(sent.some((message) => (message as { type?: string }).type === "sandboxStatus")).toBe(false)

    internal.handleEvent({
      type: "sandbox.status.changed",
      properties: { sessionID: "s1", directory: "/repo", enabled: true, available: true, version: 1 },
    })
    expect(sent).toContainEqual(expect.objectContaining({ type: "sandboxStatus", sessionID: "s1", directory: "/repo" }))
  })
})

describe("KiloProvider sandbox toggle", () => {
  it("remembers a blank composer toggle without creating a session", async () => {
    const notice = spyOn(vscode.window, "showInformationMessage").mockResolvedValue(undefined)
    const client = createClient()
    const { internal, sent } = makeProvider(client)

    await internal.handleSetSandboxDefault(true, "sandbox-1")

    expect(client.created).toHaveLength(0)
    expect(client.sandboxed).toHaveLength(0)
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "sandboxDefaultStatus",
        requestID: "sandbox-1",
        desired: true,
        enabled: true,
      }),
    )
    expect(notice).toHaveBeenCalledWith("Sandbox enabled for new sessions")
    notice.mockRestore()
  })

  it("resolves a blank worktree default against the routed directory", async () => {
    const client = createClient()
    const { internal } = makeProvider(client)

    await internal.fetchAndSendSandboxDefault("/repo/.kilo/worktrees/wt-1")

    expect(client.configReads).toEqual([{ directory: "/repo/.kilo/worktrees/wt-1" }])
    expect(client.sandboxSupport).toEqual([{ directory: "/repo/.kilo/worktrees/wt-1" }])
  })

  it("waits for a blank toggle before creating the first prompt session", async () => {
    const support = defer<{ data: { available: boolean } }>()
    const client = createClient({ supportDeferred: support })
    const { internal } = makeProvider(client)
    internal.gatherEditorContext = async () => ({})

    const toggle = internal.handleSetSandboxDefault(true, "sandbox-1")
    const send = internal.handleSendMessage("hello", "message-1", undefined, "draft-1")
    await Promise.resolve()
    expect(client.created).toHaveLength(0)

    support.resolve({ data: { available: true } })
    await Promise.all([toggle, send])
    expect(client.created).toEqual([
      expect.objectContaining({ metadata: { "kilocode.sandbox": { enabled: true, version: 0 } } }),
    ])
    expect(client.prompted).toHaveLength(1)
  })

  it("does not create a first prompt session when the blank toggle fails", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {})
    const support = defer<{ data: { available: boolean; reason?: string } }>()
    const client = createClient({ supportDeferred: support })
    const { internal, sent } = makeProvider(client)
    internal.gatherEditorContext = async () => ({})

    const toggle = internal.handleSetSandboxDefault(true, "sandbox-1")
    const send = internal.handleSendMessage("hello", "message-1", undefined, "draft-1")
    await Promise.resolve()
    expect(client.created).toHaveLength(0)
    support.resolve({ data: { available: false, reason: "unsupported" } })
    await Promise.all([toggle, send])

    expect(client.created).toHaveLength(0)
    expect(client.prompted).toHaveLength(0)
    expect(sent).toContainEqual(expect.objectContaining({ type: "sendMessageFailed", messageID: "message-1" }))
    log.mockRestore()
  })

  it("reports the disabled state in a native notification", async () => {
    const notice = spyOn(vscode.window, "showInformationMessage").mockResolvedValue(undefined)
    const sandbox = defer<{ data: unknown }>()
    const client = createClient({ sandboxDeferred: sandbox })
    const { internal } = makeProvider(client)
    internal.currentSession = mkSession()

    const toggle = internal.handleToggleSandbox({ sessionID: "s1", requestID: "sandbox-1" })
    sandbox.resolve({ data: { directory: "/repo", enabled: false, available: true, version: 2 } })
    await toggle

    expect(notice).toHaveBeenCalledTimes(1)
    expect(notice).toHaveBeenCalledWith("Sandbox disabled")
    notice.mockRestore()
  })

  it("snapshots the remembered default before sending the first prompt", async () => {
    const client = createClient()
    const { internal } = makeProvider(client)
    internal.gatherEditorContext = async () => ({})

    await internal.handleSetSandboxDefault(true, "sandbox-1")
    await internal.handleSendMessage("hello", "message-1", undefined, "draft-1")

    expect(client.created).toEqual([
      expect.objectContaining({
        directory: "/repo",
        metadata: { "kilocode.sandbox": { enabled: true, version: 0 } },
      }),
    ])
    expect(client.sandboxed).toHaveLength(0)
    expect(client.prompted).toHaveLength(1)
  })
})

describe("KiloProvider sidebar tabs", () => {
  it("creates distinct sessions for explicit drafts even when another session is current", async () => {
    const client = createClient({
      createSession: async (_params, index) => ({ data: { ...mkSession(), id: `s${index + 1}` } }),
    })
    const { internal } = makeProvider(client)
    internal.gatherEditorContext = async () => ({})

    await internal.handleSendMessage("first", "m1", undefined, "draft-1")
    await internal.handleSendMessage("second", "m2", undefined, "draft-2")
    await internal.handleSendMessage("second follow-up", "m3", undefined, "draft-2")

    expect(client.created).toHaveLength(2)
    expect(client.prompted.map((call) => call.sessionID)).toEqual(["s1", "s2", "s2"])

    internal.trackOpenSessions(["s1", "s2"])
    expect(internal.draftSessions.size).toBe(0)
  })

  it("untracks sessions removed from the sidebar working set", () => {
    const client = createClient()
    const { internal } = makeProvider(client)

    internal.trackOpenSessions(["s1", "s2"])
    internal.trackOpenSessions(["s2"])

    expect(internal.openSessionIds).toEqual(new Set(["s2"]))
    expect(internal.trackedSessionIds).toEqual(new Set(["s2"]))
  })
})

describe("KiloProvider revert ordering", () => {
  it("unwraps the nested sync payload emitted by the live SSE endpoint", () => {
    const event = unwrapSyncEvent({
      type: "sync",
      id: "evt_clear",
      syncEvent: {
        type: "session.updated.1",
        id: "evt_clear",
        seq: 0,
        aggregateID: "sessionID",
        data: { sessionID: "s1", info: { revert: null } },
      },
    })

    expect(event).toEqual({
      source: "sync",
      id: "evt_clear",
      seq: 0,
      type: "session.updated",
      properties: { sessionID: "s1", info: { revert: null } },
    })
  })

  it("waits for an in-flight revert before submitting the replacement prompt", async () => {
    const revert = defer<{ data?: unknown; error?: unknown }>()
    const client = createClient({ revertDeferred: revert })
    const { internal } = makeProvider(client)
    internal.currentSession = mkSession()
    internal.gatherEditorContext = async () => ({})

    internal.checkpoint("s1", () => internal.handleRevertSession("s1", "m1"))
    const send = internal.handleSendMessage("replacement", "m2", "s1")
    await Promise.resolve()
    await Promise.resolve()

    expect(client.reverted).toHaveLength(1)
    expect(client.prompted).toHaveLength(0)

    revert.resolve({ data: mkSession({ messageID: "m1" }) })
    await send

    expect(client.prompted).toHaveLength(1)
    expect(client.prompted[0]?.sessionID).toBe("s1")
  })

  it("waits for a revert queued while the replacement prompt gathers context", async () => {
    const context = defer<Record<string, never>>()
    const revert = defer<{ data?: unknown; error?: unknown }>()
    const client = createClient({ revertDeferred: revert })
    const { internal } = makeProvider(client)
    internal.currentSession = mkSession()
    internal.gatherEditorContext = () => context.promise

    const send = internal.handleSendMessage("replacement", "m2", "s1")
    await Promise.resolve()
    internal.checkpoint("s1", () => internal.handleRevertSession("s1", "m1"))
    context.resolve({})
    await Promise.resolve()
    await Promise.resolve()

    expect(client.prompted).toHaveLength(0)

    revert.resolve({ data: mkSession({ messageID: "m1" }) })
    await send

    expect(client.prompted).toHaveLength(1)
  })

  it("does not submit the replacement prompt when the revert fails", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const revert = defer<{ data?: unknown; error?: unknown }>()
    const client = createClient({ revertDeferred: revert })
    const { internal, sent } = makeProvider(client)
    internal.currentSession = mkSession()
    internal.gatherEditorContext = async () => ({})

    internal.checkpoint("s1", () => internal.handleRevertSession("s1", "m1"))
    const send = internal.handleSendMessage("replacement", "m2", "s1")
    await Promise.resolve()
    revert.resolve({ error: new Error("revert failed") })
    await send

    expect(client.prompted).toHaveLength(0)
    expect(sent).toContainEqual(expect.objectContaining({ type: "sendMessageFailed", messageID: "m2" }))
    error.mockRestore()
  })

  it("does not restore a stale revert boundary after a newer clear update", () => {
    const client = createClient()
    const { internal, sent } = makeProvider(client)
    internal.currentSession = mkSession({ messageID: "m1" })
    internal.trackedSessionIds.add("s1")

    internal.handleEvent({
      source: "sync",
      id: "evt_000000000002",
      seq: 0,
      type: "session.updated",
      properties: { sessionID: "s1", info: { revert: null } },
    })
    const count = sent.length

    internal.handleEvent({
      source: "sync",
      id: "evt_000000000001",
      seq: 0,
      type: "session.updated",
      properties: { sessionID: "s1", info: { revert: { messageID: "m1" } } },
    })
    internal.handleEvent({
      id: "evt_000000000001",
      type: "session.updated",
      properties: { sessionID: "s1", info: mkSession({ messageID: "m1" }) },
    })

    expect(internal.currentSession?.revert).toBeUndefined()
    expect(internal.revisions.get("s1")).toEqual({ id: "evt_000000000002", seq: 0 })
    expect(sent).toHaveLength(count)
    expect(sent.at(-1)).toMatchObject({ type: "sessionUpdated", session: { id: "s1", revert: null } })
  })

  it("uses sequence ordering for workspace-replayed session updates", () => {
    const client = createClient()
    const { internal } = makeProvider(client)
    internal.currentSession = mkSession({ messageID: "m1" })
    internal.trackedSessionIds.add("s1")

    internal.handleEvent({
      source: "sync",
      id: "evt_ffffffffffff",
      seq: 1,
      type: "session.updated",
      properties: { sessionID: "s1", info: { revert: { messageID: "m1" } } },
    })
    internal.handleEvent({
      source: "sync",
      id: "evt_000000000001",
      seq: 2,
      type: "session.updated",
      properties: { sessionID: "s1", info: { revert: null } },
    })

    expect(internal.currentSession?.revert).toBeUndefined()
    expect(internal.revisions.get("s1")).toEqual({ id: "evt_000000000001", seq: 2 })
  })

  it("publishes authoritative session state after a missed clear event", async () => {
    const client = createClient({ sessionData: mkSession() })
    const { internal, sent } = makeProvider(client)
    internal.currentSession = mkSession({ messageID: "m1" })
    internal.contextSessionID = "s1"

    internal.refreshSessionDetails("s1", "/repo")
    await Promise.resolve()
    await Promise.resolve()

    expect(internal.currentSession?.revert).toBeUndefined()
    expect(sent.at(-1)).toMatchObject({ type: "sessionUpdated", session: { id: "s1", revert: null } })
  })

  it("retries a focused session refresh after a concurrent session update", async () => {
    const first = defer<{ data: unknown }>()
    const second = defer<{ data: unknown }>()
    let calls = 0
    const client = createClient({
      sessionGet: async () => {
        calls += 1
        return calls === 1 ? first.promise : second.promise
      },
    })
    const { internal } = makeProvider(client)
    internal.currentSession = mkSession({ messageID: "m1" })
    internal.contextSessionID = "s1"
    internal.trackedSessionIds.add("s1")

    internal.refreshSessionDetails("s1", "/repo")
    internal.handleEvent({
      source: "sync",
      id: "evt_000000000001",
      seq: 0,
      type: "session.updated",
      properties: { sessionID: "s1", info: { title: "updated" } },
    })
    first.resolve({ data: mkSession() })
    await Bun.sleep(0)
    expect(calls).toBe(2)

    second.resolve({ data: { ...mkSession(), title: "updated" } })
    await Bun.sleep(0)

    expect(internal.currentSession?.id).toBe("s1")
    expect(internal.currentSession?.revert).toBeUndefined()
  })

  it("ignores an older session refresh that resolves last", async () => {
    const first = defer<{ data: unknown }>()
    const second = defer<{ data: unknown }>()
    let calls = 0
    const client = createClient({
      sessionGet: async () => {
        calls += 1
        return calls === 1 ? first.promise : second.promise
      },
    })
    const { internal, sent } = makeProvider(client)
    internal.currentSession = mkSession({ messageID: "m1" })
    internal.contextSessionID = "s1"

    internal.refreshSessionDetails("s1", "/repo")
    internal.refreshSessionDetails("s1", "/repo")
    second.resolve({ data: mkSession() })
    await Bun.sleep(0)
    first.resolve({ data: mkSession({ messageID: "m1" }) })
    await Bun.sleep(0)

    expect(internal.currentSession?.revert).toBeUndefined()
    expect(sent.filter((msg) => (msg as { type?: string }).type === "sessionUpdated")).toHaveLength(1)
  })

  it("ignores a session refresh superseded by a revert response", async () => {
    const session = defer<{ data: unknown }>()
    const client = createClient({ sessionGet: async () => session.promise })
    const { internal } = makeProvider(client)
    internal.currentSession = mkSession()
    internal.contextSessionID = "s1"

    internal.refreshSessionDetails("s1", "/repo")
    await internal.handleRevertSession("s1", "m1")
    session.resolve({ data: mkSession() })
    await Bun.sleep(0)

    expect(internal.currentSession?.revert).toEqual({ messageID: "m1" })
  })
})

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

describe("KiloProvider.handleLoadMessages / slim payload", () => {
  it("shows a cost alert even when cost arrives after the session is idle", () => {
    const client = createClient()
    const { internal, sent } = makeProvider(client)
    mockMaxCost(internal, 1)
    internal.trackedSessionIds.add("s1")
    internal.handleEvent({
      type: "session.status",
      properties: { sessionID: "s1", status: { type: "idle" } },
    })

    internal.handleEvent({
      type: "session.updated",
      properties: {
        sessionID: "s1",
        info: {
          id: "s1",
          cost: 1.46,
        },
      },
    })

    expect(sent).toContainEqual({
      type: "sessionCostAlert",
      sessionID: "s1",
      limit: 1,
      cost: "$1.46",
    })
  })

  it("shares the in-memory limit across provider instances", () => {
    const settings = makeProvider(createClient())
    const chat = makeProvider(createClient())
    mockMaxCost(settings.internal, 1)
    chat.internal.trackedSessionIds.add("s1")

    chat.internal.handleEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 1 }, cost: 1.5 },
      },
    })

    expect(chat.sent).toContainEqual({
      type: "sessionCostAlert",
      sessionID: "s1",
      limit: 1,
      cost: "$1.50",
    })
  })

  it("remembers continue for that session and limit", async () => {
    const client = createClient()
    const { internal, sent } = makeProvider(client)
    mockMaxCost(internal, 1)
    internal.trackedSessionIds.add("s1")

    await internal.handleCostAlertResponse("s1", 1, "continue")
    sent.length = 0
    internal.handleEvent({
      type: "session.updated",
      properties: {
        sessionID: "s1",
        info: {
          id: "s1",
          cost: 1.46,
        },
      },
    })

    expect(
      sent.some((msg) => typeof msg === "object" && msg && (msg as { type?: unknown }).type === "sessionCostAlert"),
    ).toBe(false)
  })

  it("re-alerts after stop when the session reruns above the limit", async () => {
    const client = createClient()
    const { internal, sent } = makeProvider(client)
    mockMaxCost(internal, 1)
    internal.trackedSessionIds.add("s1")
    internal.handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "s1", status: { type: "busy" } },
      },
      "/repo",
    )

    internal.handleEvent({
      type: "session.updated",
      properties: {
        sessionID: "s1",
        info: {
          id: "s1",
          cost: 1.46,
        },
      },
    })
    await internal.handleCostAlertResponse("s1", 1, "stop")

    // Same run: alert already shown, no duplicate within same run
    sent.length = 0
    internal.handleEvent({
      type: "session.updated",
      properties: {
        sessionID: "s1",
        info: {
          id: "s1",
          cost: 1.46,
        },
      },
    })
    expect(
      sent.some((msg) => typeof msg === "object" && msg && (msg as { type?: unknown }).type === "sessionCostAlert"),
    ).toBe(false)

    // New run (busy rearms): alert fires again since stop does not ack the limit
    sent.length = 0
    internal.handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "s1", status: { type: "busy" } },
      },
      "/repo",
    )
    internal.handleEvent({
      type: "session.updated",
      properties: {
        sessionID: "s1",
        info: {
          id: "s1",
          cost: 1.46,
        },
      },
    })

    expect(sent).toContainEqual({
      type: "sessionCostAlert",
      sessionID: "s1",
      limit: 1,
      cost: "$1.46",
    })
  })

  it("alerts from message.updated assistant cost — the reliable cost signal", () => {
    const client = createClient()
    const { internal, sent } = makeProvider(client)
    mockMaxCost(internal, 1)
    internal.trackedSessionIds.add("s1")

    internal.handleEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 1 }, cost: 1.5 },
      },
    })

    expect(sent).toContainEqual({
      type: "sessionCostAlert",
      sessionID: "s1",
      limit: 1,
      cost: "$1.50",
    })
  })

  it("does not re-alert on repeated busy status while already active", () => {
    const client = createClient()
    const { internal, sent } = makeProvider(client)
    mockMaxCost(internal, 1)
    internal.trackedSessionIds.add("s1")
    internal.handleEvent({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }, "/repo")
    internal.handleEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 1 }, cost: 1.5 },
      },
    })
    sent.length = 0

    internal.handleEvent({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }, "/repo")
    internal.handleEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 1 }, cost: 1.5 },
      },
    })

    expect(
      sent.some((msg) => typeof msg === "object" && msg && (msg as { type?: unknown }).type === "sessionCostAlert"),
    ).toBe(false)
  })

  it("does not block sends above the limit", async () => {
    const client = createClient()
    const { internal } = makeProvider(client)
    mockMaxCost(internal, 1)
    internal.currentSession = { ...mkSession(), cost: 2 }
    internal.gatherEditorContext = async () => ({})

    await internal.handleSendMessage("hello", "m1", "s1")

    expect(client.prompted).toHaveLength(1)
  })

  it("aborts when the cost alert is stopped", async () => {
    const client = createClient()
    const { internal, sent } = makeProvider(client)
    mockMaxCost(internal, 1)
    internal.trackedSessionIds.add("s1")
    internal.handleEvent({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }, "/repo")
    internal.handleEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 1 }, cost: 2 },
      },
    })

    await internal.handleCostAlertResponse("s1", 1, "stop")

    expect(client.aborted).toContainEqual({ sessionID: "s1", directory: "/repo" })
    expect(sent).toContainEqual({ type: "sessionCostAlertResolved", sessionID: "s1", limit: 1 })
    expect(sent).toContainEqual({ type: "sessionTurnClosed", sessionID: "s1", reason: "interrupted" })
  })

  it("strips transcript-only metadata before posting messages to the webview", async () => {
    const user = mkMessage("m1", "user", 1)
    const assistant = mkMessage("m2", "assistant", 2)
    const client = createClient({
      messagesData: [
        {
          ...user,
          info: {
            ...user.info,
            summary: { diffs: [{ file: "a.ts", patch: "full patch", additions: 2, deletions: 1 }] },
          },
        },
        {
          ...assistant,
          parts: [
            {
              type: "reasoning",
              id: "r1",
              text: "Considering options",
              metadata: { openai: { reasoningEncryptedContent: "encrypted", itemId: "item-1" } },
            },
          ],
        },
      ],
    })
    const { provider, sent } = makeProvider(client)

    await provider.loadMessages("s1")

    const loaded = sent.find(
      (msg) => typeof msg === "object" && msg && (msg as { type?: unknown }).type === "messagesLoaded",
    ) as
      | {
          messages: Array<{
            summary?: { diffs?: Array<Record<string, unknown>> }
            parts: Array<{ metadata?: { openai?: Record<string, unknown> } }>
          }>
        }
      | undefined
    expect(loaded?.messages[0]?.summary?.diffs?.[0]).toEqual({ file: "a.ts", additions: 2, deletions: 1 })
    expect(loaded?.messages[1]?.parts[0]?.metadata?.openai).toEqual({ itemId: "item-1" })
  })

  it("strips summary patches from live message updates", () => {
    const client = createClient()
    const { internal, sent } = makeProvider(client)

    internal.handleEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "m1",
          sessionID: "s1",
          role: "user",
          time: { created: 1 },
          summary: { diffs: [{ file: "a.ts", patch: "full patch", additions: 2, deletions: 1 }] },
        },
      },
    })

    const created = sent.find(
      (msg) => typeof msg === "object" && msg && (msg as { type?: unknown }).type === "messageCreated",
    ) as { message?: { summary?: { diffs?: Array<Record<string, unknown>> } } } | undefined
    expect(created?.message?.summary?.diffs?.[0]).toEqual({ file: "a.ts", additions: 2, deletions: 1 })
  })
})

describe("KiloProvider.loadMessages / sub-agent viewer", () => {
  it("uses the same paginated initial load as normal sessions", async () => {
    const page = Array.from({ length: 80 }, (_, i) => mkMessage(`m${i}`, i % 2 === 0 ? "user" : "assistant", i))
    const client = createClient({ messagesData: page })
    const { provider, sent } = makeProvider(client)

    await provider.loadMessages("s1")

    const loaded = sent.find(
      (msg) => typeof msg === "object" && msg && (msg as { type?: unknown }).type === "messagesLoaded",
    ) as { messages: unknown[]; hasMore: boolean } | undefined
    expect(loaded?.messages).toHaveLength(80)
    expect(loaded?.hasMore).toBe(true)
    expect(client.calls).toEqual([{ before: undefined, limit: 80 }])
  })

  it("delivers reasoning updates received during the initial snapshot after messagesLoaded", async () => {
    const pending = defer<{ data: unknown[]; response: { headers: Headers } }>()
    const client = createClient({ messagesDeferred: pending })
    const { provider, internal, sent } = makeProvider(client)
    const load = provider.loadMessages("s1")

    internal.streams.push({
      type: "partUpdated",
      sessionID: "s1",
      messageID: "m2",
      part: {
        id: "r1",
        sessionID: "s1",
        messageID: "m2",
        type: "reasoning",
        text: "Complete reasoning",
      },
    })
    pending.resolve(
      mkResult([
        mkMessage("m1", "user", 1),
        {
          ...mkMessage("m2", "assistant", 2),
          parts: [
            {
              id: "r1",
              sessionID: "s1",
              messageID: "m2",
              type: "reasoning",
              text: "",
            },
          ],
        },
      ]),
    )
    await load

    const types = sent.map((msg) => (typeof msg === "object" && msg ? (msg as { type?: string }).type : undefined))
    const snapshot = types.indexOf("messagesLoaded")
    const update = types.findIndex((type) => type === "partUpdated" || type === "partsUpdated")
    expect(snapshot).toBeGreaterThanOrEqual(0)
    expect(update).toBeGreaterThan(snapshot)
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
