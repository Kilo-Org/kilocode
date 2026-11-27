import { describe, expect, it } from "bun:test"
import type { SessionStatus } from "@kilocode/sdk/v2/client"
import { ProjectRouteService } from "../../src/agent-manager/project/route"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type EventFilter = (payload: unknown, directory?: string) => boolean
type EventListener = (payload: unknown, directory?: string) => void

type Internals = {
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  isWebviewReady: boolean
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  trackedSessionIds: Set<string>
  sessionStatusMap: Map<string, SessionStatus["type"]>
  wakeupSessions: Set<string>
  retryAbortControllers: Map<string, AbortController>
  aborts: {
    observe: (sessionID: string, status: SessionStatus["type"], dir?: string) => void
    has: (sessionID: string) => boolean
  }
  handleEvent: (event: unknown, directory?: string) => void
  initializeConnection: () => Promise<void>
  reloadAfterAuthChange: () => Promise<void>
  withRetry: (
    fn: () => Promise<{ error?: unknown; response?: Response }>,
    sid: string,
    messageID?: string,
  ) => Promise<void>
  seedSessionStatusMap: (reconcile?: boolean) => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  fetchAndSendConfig: () => Promise<void>
  fetchAndSendAgents: () => Promise<void>
  fetchAndSendSkills: () => Promise<void>
  fetchAndSendCommands: () => Promise<void>
  fetchAndSendIndexingStatus: () => Promise<void>
  fetchAndSendNotifications: () => Promise<void>
  promptRecovery: Promise<void> | null
}

function createFixture(options?: {
  root?: string
  worktrees?: string[]
  dirs?: string[]
  routeService?: ProjectRouteService
  projectId?: string
  statuses?: (dir: string) => Promise<{ data: Record<string, SessionStatus> | null }>
  wakeups?: (dir: string) => Promise<{ data: Array<{ sessionID: string; pending: number }> }>
  permissions?: (dir: string) => Promise<{ data: Array<Record<string, unknown>> }>
  questions?: (dir: string) => Promise<{ data: Array<Record<string, unknown>> }>
  suggestions?: (dir: string) => Promise<{ data: Array<Record<string, unknown>> }>
}) {
  const root = options?.root ?? "/repo"
  const worktrees = options?.worktrees ?? []
  const known = options?.dirs ?? [root, ...worktrees]
  let filter: EventFilter | undefined
  let listener: EventListener | undefined
  const recordedPermissions: string[] = []
  const recordedQuestions: string[] = []
  const client = {
    session: {
      status: async (params: { directory: string }) =>
        options?.statuses ? options.statuses(params.directory) : { data: {} },
    },
    kilocode: {
      wakeups: async (params: { directory: string }) =>
        options?.wakeups ? options.wakeups(params.directory) : { data: [] },
    },
    permission: {
      list: async (params: { directory: string }) =>
        options?.permissions ? options.permissions(params.directory) : { data: [] },
    },
    question: {
      list: async (params: { directory: string }) =>
        options?.questions ? options.questions(params.directory) : { data: [] },
    },
    suggestion: {
      list: async (params: { directory: string }) =>
        options?.suggestions ? options.suggestions(params.directory) : { data: [] },
    },
    kilo: {
      profile: async () => ({ data: null }),
    },
    config: {
      warnings: async () => ({ data: [] }),
    },
  }
  const noop = () => () => undefined
  const service = {
    connect: async () => {},
    getClient: () => client,
    getServerInfo: () => null,
    getServerConfig: () => ({ baseUrl: "http://127.0.0.1:9999", password: "test" }),
    getConnectionState: () => "connected" as const,
    getConnectionError: () => null,
    getKnownDirectories: () => known,
    resolveEventSessionId: () => undefined,
    onEventFiltered: (nextFilter: EventFilter, nextListener: EventListener) => {
      filter = nextFilter
      listener = nextListener
      return () => {
        filter = undefined
        listener = undefined
      }
    },
    onStateChange: noop,
    onNotificationDismissed: noop,
    onLanguageChanged: noop,
    onProfileChanged: noop,
    onFavoritesChanged: noop,
    onModelSelectorExpandedChanged: noop,
    onClearPendingPrompts: noop,
    registerDirectoryProvider: noop,
    unregisterVisible: () => undefined,
    unregisterAttached: () => undefined,
    getPermissionRevision: () => 0,
    recordPermissionDirectory: (id: string) => recordedPermissions.push(id),
    prunePermissionDirectories: () => undefined,
    isPermissionResponseClaimed: () => false,
    getQuestionRevision: () => 0,
    recordQuestionDirectory: (id: string) => recordedQuestions.push(id),
    pruneQuestionDirectories: () => undefined,
  }
  const provider = new KiloProvider({} as never, service as never, undefined, {
    rootDirectory: () => root,
    worktreeDirectories: () => worktrees,
    routeService: options?.routeService,
    projectQualifier: options?.projectId ? () => ({ projectId: options.projectId! }) : undefined,
  })
  const internal = provider as unknown as Internals
  const messages: Array<Record<string, unknown>> = []
  internal.connectionState = "connected"
  internal.isWebviewReady = true
  internal.webview = { postMessage: async (message) => void messages.push(message as Record<string, unknown>) }
  internal.fetchAndSendProviders = async () => {}
  internal.fetchAndSendConfig = async () => {}
  internal.fetchAndSendAgents = async () => {}
  internal.fetchAndSendSkills = async () => {}
  internal.fetchAndSendCommands = async () => {}
  internal.fetchAndSendIndexingStatus = async () => {}
  internal.fetchAndSendNotifications = async () => {}
  return {
    provider,
    internal,
    messages,
    recordedPermissions,
    recordedQuestions,
    emit: (payload: unknown, directory?: string) => {
      if (filter?.(payload, directory)) listener?.(payload, directory)
    },
  }
}

describe("KiloProvider disposal reconciliation", () => {
  it("publishes idle status and cancels host retry loops on server.instance.disposed", async () => {
    const wt1 = "/repo/wt-1"
    const wt2 = "/repo/wt-2"
    const fixture = createFixture({ worktrees: [wt1, wt2] })
    fixture.provider.setSessionDirectory("s-busy", wt1)
    fixture.provider.setSessionDirectory("s-retry", wt1)
    fixture.provider.setSessionDirectory("s-offline", wt1)
    fixture.provider.setSessionDirectory("s-other", wt2)

    fixture.internal.handleEvent(
      { type: "session.status", properties: { sessionID: "s-busy", status: { type: "busy" } } },
      wt1,
    )
    fixture.internal.handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "s-offline", status: { type: "offline", message: "offline" } },
      },
      wt1,
    )
    fixture.internal.handleEvent(
      { type: "session.status", properties: { sessionID: "s-other", status: { type: "busy" } } },
      wt2,
    )

    // Start an actual host retry loop for s-retry that waits in backoff.
    let calls = 0
    const failed = Promise.withResolvers<void>()
    const retryTask = fixture.internal.withRetry(async () => {
      calls += 1
      failed.resolve()
      return { error: new Error("server unavailable"), response: new Response(null, { status: 503 }) }
    }, "s-retry")
    await failed.promise
    await Bun.sleep(0)
    expect(fixture.internal.retryAbortControllers.has("s-retry")).toBe(true)

    fixture.messages.length = 0
    fixture.internal.handleEvent({ type: "server.instance.disposed", properties: { directory: wt1 } }, wt1)

    // The retry loop must exit promptly because its AbortController was aborted.
    await retryTask
    expect(calls).toBe(1)
    expect(fixture.internal.retryAbortControllers.has("s-retry")).toBe(false)

    expect(fixture.internal.sessionStatusMap.get("s-busy")).toBe("idle")
    expect(fixture.internal.sessionStatusMap.get("s-retry")).toBe("idle")
    expect(fixture.internal.sessionStatusMap.get("s-offline")).toBe("idle")
    expect(fixture.internal.sessionStatusMap.get("s-other")).toBe("busy")

    const statuses = fixture.messages.filter((m) => m.type === "sessionStatus")
    expect(statuses).toEqual([
      { type: "sessionStatus", sessionID: "s-busy", status: "idle" },
      { type: "sessionStatus", sessionID: "s-offline", status: "idle" },
      { type: "sessionStatus", sessionID: "s-retry", status: "idle" },
    ])
  })

  it("does not post a new retry status when disposal cancels while the HTTP attempt is still in flight", async () => {
    const wt = "/repo/wt-1"
    const fixture = createFixture({ worktrees: [wt] })
    fixture.provider.setSessionDirectory("s-inflight", wt)

    const request = Promise.withResolvers<{ error?: unknown; response?: Response }>()
    const task = fixture.internal.withRetry(() => request.promise, "s-inflight")
    expect(fixture.internal.retryAbortControllers.has("s-inflight")).toBe(true)

    fixture.internal.handleEvent({ type: "server.instance.disposed", properties: { directory: wt } }, wt)
    request.resolve({ error: new Error("disposed"), response: new Response(null, { status: 503 }) })
    await task

    const statuses = fixture.messages.filter((m) => m.type === "sessionStatus")
    expect(statuses).toEqual([{ type: "sessionStatus", sessionID: "s-inflight", status: "idle" }])
  })

  it("keeps a session non-idle if it is still active in another non-disposed directory", () => {
    const wt1 = "/repo/wt-1"
    const wt2 = "/repo/wt-2"
    const fixture = createFixture({ worktrees: [wt1, wt2] })
    fixture.provider.setSessionDirectory("s-shared", wt1)
    fixture.internal.handleEvent(
      { type: "session.status", properties: { sessionID: "s-shared", status: { type: "busy" } } },
      wt1,
    )
    fixture.internal.handleEvent(
      { type: "session.status", properties: { sessionID: "s-shared", status: { type: "busy" } } },
      wt2,
    )
    fixture.messages.length = 0

    fixture.internal.handleEvent({ type: "server.instance.disposed", properties: { directory: wt1 } }, wt1)

    expect(fixture.internal.sessionStatusMap.get("s-shared")).toBe("busy")
    expect(fixture.internal.aborts.has("s-shared")).toBe(true)
    expect(fixture.messages.filter((m) => m.type === "sessionStatus")).toEqual([])
  })

  it("reconciles non-idle sessions across all directories and cancels retries on global.disposed", async () => {
    const wt1 = "/repo/wt-1"
    const wt2 = "/repo/wt-2"
    const fixture = createFixture({ worktrees: [wt1, wt2] })
    fixture.provider.setSessionDirectory("s-root", "/repo")
    fixture.provider.setSessionDirectory("s-wt1", wt1)
    fixture.provider.setSessionDirectory("s-wt2", wt2)

    fixture.internal.handleEvent(
      { type: "session.status", properties: { sessionID: "s-root", status: { type: "busy" } } },
      "/repo",
    )
    fixture.internal.handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "s-wt1", status: { type: "retry", attempt: 1, message: "err", next: 100 } },
      },
      wt1,
    )
    const controller = new AbortController()
    fixture.internal.retryAbortControllers.set("s-wt2", controller)
    fixture.messages.length = 0

    fixture.internal.handleEvent({ type: "global.disposed", properties: {} }, "global")
    await Bun.sleep(0)

    expect(controller.signal.aborted).toBe(true)
    expect(fixture.internal.aborts.has("s-root")).toBe(false)
    expect(fixture.internal.aborts.has("s-wt1")).toBe(false)
    expect(fixture.internal.sessionStatusMap.get("s-root")).toBe("idle")
    expect(fixture.internal.sessionStatusMap.get("s-wt1")).toBe("idle")
    expect(fixture.internal.sessionStatusMap.get("s-wt2")).toBe("idle")
    expect(fixture.messages.filter((m) => m.type === "sessionStatus")).toEqual([
      { type: "sessionStatus", sessionID: "s-root", status: "idle" },
      { type: "sessionStatus", sessionID: "s-wt1", status: "idle" },
      { type: "sessionStatus", sessionID: "s-wt2", status: "idle" },
    ])
  })

  it("passes server.instance.disposed for an inactive project directory through onEventFiltered", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("proj-active", "/active", 1)
    routes.registerProject("proj-bg", "/bg", 1)
    routes.registerWorktree({ projectId: "proj-bg", worktreeId: "wt-bg" }, "/bg/wt", 1)
    routes.registerSession({ projectId: "proj-bg", sessionId: "s-bg" }, "/bg/wt", 1)

    const fixture = createFixture({
      root: "/active",
      routeService: routes,
      projectId: "proj-active",
    })
    await fixture.internal.initializeConnection()
    fixture.internal.trackedSessionIds.add("s-bg")
    fixture.internal.handleEvent(
      { type: "session.status", properties: { sessionID: "s-bg", status: { type: "busy" } } },
      "/bg/wt",
    )
    fixture.messages.length = 0

    fixture.emit({ type: "server.instance.disposed", properties: { directory: "/bg/wt" } }, "/bg/wt")

    expect(fixture.internal.sessionStatusMap.get("s-bg")).toBe("idle")
    expect(fixture.messages).toContainEqual({ type: "sessionStatus", sessionID: "s-bg", status: "idle" })
  })

  it("drops an older in-flight session status poll that resolves after server.instance.disposed", async () => {
    const wt = "/repo/wt-1"
    const gate = Promise.withResolvers<{ data: Record<string, SessionStatus> | null }>()
    const fixture = createFixture({
      worktrees: [wt],
      statuses: (dir) => (dir === wt ? gate.promise : Promise.resolve({ data: {} })),
    })
    fixture.provider.setSessionDirectory("s-stale", wt)
    fixture.internal.trackedSessionIds.add("s-stale")
    fixture.internal.handleEvent(
      { type: "session.status", properties: { sessionID: "s-stale", status: { type: "busy" } } },
      wt,
    )

    const poll = fixture.internal.seedSessionStatusMap()
    fixture.messages.length = 0
    fixture.internal.handleEvent({ type: "server.instance.disposed", properties: { directory: wt } }, wt)
    gate.resolve({ data: { "s-stale": { type: "busy" } } })
    await poll

    expect(fixture.internal.sessionStatusMap.get("s-stale")).toBe("idle")
    expect(fixture.messages.filter((m) => m.type === "sessionStatus")).toEqual([
      { type: "sessionStatus", sessionID: "s-stale", status: "idle" },
    ])
  })

  it("reloadAfterAuthChange clears stale prompts and re-seeds statuses, wakeups, and live prompts", async () => {
    const wt = "/repo/wt-1"
    const fixture = createFixture({
      worktrees: [wt],
      statuses: async (dir) => ({
        data: dir === wt ? { "s-live": { type: "busy" } } : {},
      }),
      wakeups: async (dir) => ({
        data: dir === wt ? [{ sessionID: "s-wake-live", pending: 2 }] : [],
      }),
      permissions: async (dir) => ({
        data:
          dir === wt
            ? [{ id: "perm-live", sessionID: "s-live", permission: "bash", patterns: ["ls"], always: [], metadata: {} }]
            : [],
      }),
      questions: async (dir) => ({
        data: dir === wt ? [{ id: "q-live", sessionID: "s-live", questions: [], blocking: true }] : [],
      }),
      suggestions: async (dir) => ({
        data: dir === wt ? [{ id: "sug-live", sessionID: "s-live", text: "Try tests", actions: [] }] : [],
      }),
    })
    fixture.provider.setSessionDirectory("s-stale", wt)
    fixture.provider.setSessionDirectory("s-live", wt)
    fixture.internal.trackedSessionIds.add("s-stale")
    fixture.internal.trackedSessionIds.add("s-live")
    fixture.internal.sessionStatusMap.set("s-stale", "busy")
    fixture.internal.wakeupSessions.add("s-wake-stale")

    await fixture.internal.reloadAfterAuthChange()
    if (fixture.internal.promptRecovery) await fixture.internal.promptRecovery

    const clearIdx = fixture.messages.findIndex((m) => m.type === "clearPendingPrompts")
    const permIdx = fixture.messages.findIndex((m) => m.type === "permissionRequest")
    const qIdx = fixture.messages.findIndex((m) => m.type === "questionRequest")
    const sugIdx = fixture.messages.findIndex((m) => m.type === "suggestionRequest")
    expect(clearIdx).toBeGreaterThanOrEqual(0)
    expect(permIdx).toBeGreaterThan(clearIdx)
    expect(qIdx).toBeGreaterThan(clearIdx)
    expect(sugIdx).toBeGreaterThan(clearIdx)

    expect(fixture.messages).toContainEqual({ type: "sessionStatus", sessionID: "s-stale", status: "idle" })
    expect(fixture.messages).toContainEqual({ type: "sessionStatus", sessionID: "s-live", status: "busy" })
    expect(fixture.messages).toContainEqual({ type: "sessionWakeup", sessionID: "s-wake-stale", pending: 0 })
    expect(fixture.messages).toContainEqual({ type: "sessionWakeup", sessionID: "s-wake-live", pending: 2 })
    expect(fixture.internal.sessionStatusMap.get("s-stale")).toBe("idle")
    expect(fixture.internal.sessionStatusMap.get("s-live")).toBe("busy")
  })

  it("invalidates an in-flight pre-disposal prompt recovery so stale permissions are not reposted", async () => {
    const first = Promise.withResolvers<{ data: Array<Record<string, unknown>> }>()
    let calls = 0
    const fixture = createFixture({
      permissions: () => {
        calls += 1
        if (calls === 1) return first.promise
        return Promise.resolve({ data: [] })
      },
    })
    fixture.internal.trackedSessionIds.add("s-1")

    fixture.provider.recoverPendingPrompts()
    expect(calls).toBe(1)

    const reload = fixture.internal.reloadAfterAuthChange()
    first.resolve({
      data: [{ id: "perm-stale", sessionID: "s-1", permission: "bash", patterns: ["rm"], always: [], metadata: {} }],
    })
    await reload
    if (fixture.internal.promptRecovery) await fixture.internal.promptRecovery

    expect(calls).toBeGreaterThanOrEqual(2)
    expect(fixture.messages).toContainEqual({ type: "clearPendingPrompts" })
    expect(fixture.messages.filter((m) => m.type === "permissionRequest")).toEqual([])
  })
})
