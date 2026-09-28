import { describe, expect, it } from "bun:test"
import type { Event, Session } from "@kilocode/sdk/v2/client"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")
const { ProjectRouteService } = await import("../../src/agent-manager/project/route")
const { resolveEventSessionId } = await import("../../src/services/cli-backend/connection-utils")

type Internals = {
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  trackedSessionIds: Set<string>
  syncedChildSessions: Set<string>
  sessionDirectories: Map<string, string>
  sessionStatusMap: Map<string, string>
  owners: Map<string, { dir: string; project: string }>
  currentSession: Session | null
  projectID: string | undefined
  isWebviewReady: boolean
  pendingFollowup: { dir: string; time: number } | null
  handleLoadMessages: (sessionID: string) => Promise<void>
  releaseChildSession: (sessionID: string) => void
  handleEvent: (event: Event, directory?: string) => void
  refreshGitStatus: (directory?: string) => Promise<void>
  refreshGitStatusFromParts: (parts: unknown[], sessionID?: string) => Promise<boolean>
  resolveGitRoot: (directory: string) => Promise<string | undefined>
  initializeConnection: () => Promise<void>
  syncWebviewState: () => Promise<void>
  flushPendingSessionRefresh: () => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  fetchAndSendAgents: () => Promise<void>
  fetchAndSendSkills: () => Promise<void>
  fetchAndSendCommands: () => Promise<void>
  fetchAndSendConfig: () => Promise<void>
  fetchAndSendNotifications: () => Promise<void>
  seedSessionStatusMap: () => Promise<void>
  sendNotificationSettings: () => void
  startStatsPolling: () => void
  statsPoller: { stop: () => void } | null
}

function created(input: { id: string; directory: string; parentID?: string }): Event {
  return {
    type: "session.created",
    properties: {
      sessionID: input.id,
      info: {
        id: input.id,
        slug: `${input.id}-slug`,
        projectID: "project-1",
        directory: input.directory,
        title: "Session",
        version: "1",
        time: { created: 1, updated: 1 },
        parentID: input.parentID,
      },
    },
  } as Event
}

function info(input: { id: string; projectID: string; directory: string }): Session {
  return {
    id: input.id,
    slug: `${input.id}-slug`,
    projectID: input.projectID,
    directory: input.directory,
    title: "Session",
    version: "1",
    time: { created: 1, updated: 1 },
  }
}

function connection() {
  let filter: ((event: Event, directory?: string) => boolean) | undefined
  let listener: ((event: Event, directory?: string) => void) | undefined

  return {
    emit(event: Event, directory?: string) {
      if (!filter || !listener) throw new Error("expected SSE subscription")
      if (!filter(event, directory)) return
      listener(event, directory)
    },
    connect: async () => {},
    getClient: () => ({}) as never,
    onEventFiltered: (
      next: (event: Event, directory?: string) => boolean,
      cb: (event: Event, directory?: string) => void,
    ) => {
      filter = next
      listener = cb
      return () => undefined
    },
    onStateChange: () => () => undefined,
    onNotificationDismissed: () => () => undefined,
    onClearPendingPrompts: () => () => undefined,
    onLanguageChanged: () => () => undefined,
    onProfileChanged: () => () => undefined,
    onFavoritesChanged: () => () => undefined,
    onModelSelectorExpandedChanged: () => () => undefined,
    registerDirectoryProvider: () => () => undefined,
    unregisterVisible: () => undefined,
    unregisterAttached: () => undefined,
    getServerInfo: () => ({ port: 12345 }),
    getServerConfig: () => ({ baseUrl: "http://127.0.0.1:12345", password: "test" }),
    getConnectionState: () => "connected" as const,
    getConnectionError: () => null,
    resolveEventSessionId: (event: Event) => (event.type === "session.created" ? event.properties.info.id : undefined),
    recordMessageSessionId: () => undefined,
    notifyNotificationDismissed: () => undefined,
    clearPermissionSession: () => undefined,
    pruneSession: () => undefined,
  }
}

function git() {
  const service = connection()
  const client = { project: { current: async () => ({ data: { vcs: "git" } }) } }
  return { ...service, getClient: () => client as never }
}

describe("KiloProvider follow-up sessions", () => {
  it.each([
    ["released child", "idle"],
    ["released child", "offline"],
    ["directory", "idle"],
    ["directory", "offline"],
    ["directory", "deleted"],
    ["route", "idle"],
    ["route", "offline"],
    ["route", "deleted"],
    ["synced child", "idle"],
    ["synced child", "offline"],
    ["synced child", "deleted"],
    ["collision", "idle"],
    ["collision", "offline"],
    ["collision", "deleted"],
  ])("routes inactive-project %s status event: %s", async (scope, status) => {
    const service = connection()
    let root = "/repo/project-a"
    const routes = new ProjectRouteService()
    const provider = new KiloProvider({} as never, service as never, undefined, {
      rootDirectory: () => root,
      projectQualifier: () => ({ projectId: root }),
      routeService: routes,
    })
    const internal = provider as unknown as Internals
    const sent: unknown[] = []
    const child = "ses-child"
    internal.webview = {
      postMessage: async (message: unknown) => {
        sent.push(message)
        return true
      },
    }
    internal.syncWebviewState = async () => {}
    internal.flushPendingSessionRefresh = async () => {}
    internal.fetchAndSendProviders = async () => {}
    internal.fetchAndSendAgents = async () => {}
    internal.fetchAndSendSkills = async () => {}
    internal.fetchAndSendCommands = async () => {}
    internal.fetchAndSendConfig = async () => {}
    internal.fetchAndSendNotifications = async () => {}
    internal.seedSessionStatusMap = async () => {}
    internal.sendNotificationSettings = () => {}
    internal.startStatsPolling = () => {}
    await internal.initializeConnection()

    if (scope === "route" || scope === "collision") {
      routes.registerProject(root, root, 1)
      routes.registerSession({ projectId: root, sessionId: child }, root, 1)
    }
    if (scope !== "route") internal.sessionDirectories.set(child, root)
    if (scope.includes("child")) {
      internal.owners.set(child, { dir: root, project: root })
      internal.syncedChildSessions.add(child)
    }
    internal.trackedSessionIds.add(child)
    service.emit({ type: "session.status", properties: { sessionID: child, status: { type: "busy" } } } as Event, root)
    if (scope === "released child") {
      internal.releaseChildSession(child)
      expect(internal.trackedSessionIds.has(child)).toBe(false)
      expect(internal.sessionDirectories.has(child)).toBe(false)
      expect(internal.owners.get(child)).toEqual({ dir: "/repo/project-a", project: "/repo/project-a" })
    }
    if (!scope.includes("child")) expect(internal.owners.has(child)).toBe(false)

    root = "/repo/project-b"
    if (scope === "collision") {
      routes.registerProject(root, root, 1)
      routes.registerSession({ projectId: root, sessionId: child }, root, 1)
      internal.sessionDirectories.set(child, root)
      internal.currentSession = info({ id: child, projectID: root, directory: root })
    }
    const event = (
      status === "deleted"
        ? { type: "session.deleted", properties: { sessionID: child } }
        : { type: "session.status", properties: { sessionID: child, status: { type: status } } }
    ) as Event
    const count = sent.length
    service.emit(event, "/repo/project-c")
    expect(internal.sessionStatusMap.get(child)).toBe("busy")
    expect(sent).toHaveLength(count)
    service.emit(
      { type: "session.status", properties: { sessionID: child, status: { type: "retry", attempt: 1 } } } as Event,
      "/repo/project-a",
    )
    if (scope === "collision") expect(sent).toHaveLength(count)
    if (scope !== "collision") {
      expect(sent).toContainEqual(expect.objectContaining({ type: "sessionStatus", sessionID: child, status: "retry" }))
    }
    service.emit(event, "/repo/project-a")

    if (scope === "collision") {
      expect(sent).toHaveLength(count)
      expect(internal.sessionStatusMap.get(child)).toBe("busy")
      expect(internal.trackedSessionIds.has(child)).toBe(true)
      expect(internal.sessionDirectories.get(child)).toBe(root)
      expect(internal.currentSession?.directory).toBe(root)
      service.emit(event, root)
    }

    if (status === "deleted") {
      expect(internal.trackedSessionIds.has(child)).toBe(false)
      expect(internal.sessionDirectories.has(child)).toBe(false)
      expect(sent).toContainEqual({ type: "sessionDeleted", sessionID: child })
      return
    }
    expect(internal.sessionStatusMap.get(child)).toBe(status)
    expect(sent).toContainEqual({ type: "sessionStatus", sessionID: child, status })
    if (scope === "released child") expect(internal.owners.has(child)).toBe(status === "offline")
    if (scope === "synced child") expect(internal.syncedChildSessions.has(child)).toBe(true)
    if (status !== "offline" || scope === "collision") return
    // A reconnected session must replace the offline status, or the row keeps its error icon.
    service.emit(
      { type: "session.status", properties: { sessionID: child, status: { type: "busy" } } } as Event,
      "/repo/project-a",
    )
    expect(internal.sessionStatusMap.get(child)).toBe("busy")
    expect(sent.at(-1)).toEqual({ type: "sessionStatus", sessionID: child, status: "busy" })
  })

  it("forwards every activity event of an inactive-project session", async () => {
    const base = connection()
    const service = { ...base, resolveEventSessionId: (event: Event) => resolveEventSessionId(event, () => undefined) }
    const routes = new ProjectRouteService()
    const provider = new KiloProvider({} as never, service as never, undefined, {
      rootDirectory: () => "/repo/project-b",
      projectQualifier: () => ({ projectId: "/repo/project-b" }),
      routeService: routes,
    })
    const internal = provider as unknown as Internals
    const sent: { type: string }[] = []
    internal.webview = {
      postMessage: async (message: unknown) => {
        sent.push(message as { type: string })
        return true
      },
    }
    internal.syncWebviewState = async () => {}
    internal.flushPendingSessionRefresh = async () => {}
    internal.fetchAndSendProviders = async () => {}
    internal.fetchAndSendAgents = async () => {}
    internal.fetchAndSendSkills = async () => {}
    internal.fetchAndSendCommands = async () => {}
    internal.fetchAndSendConfig = async () => {}
    internal.fetchAndSendNotifications = async () => {}
    internal.seedSessionStatusMap = async () => {}
    internal.sendNotificationSettings = () => {}
    internal.startStatsPolling = () => {}
    await internal.initializeConnection()

    const dir = "/repo/project-a"
    const sid = "ses-background"
    routes.registerProject(dir, dir, 1)
    routes.registerSession({ projectId: dir, sessionId: sid }, dir, 1)
    internal.sessionDirectories.set(sid, dir)
    internal.trackedSessionIds.add(sid)
    const events = [
      { type: "session.turn.close", id: "evt-1", properties: { sessionID: sid, reason: "error" } },
      { type: "session.error", id: "evt-2", properties: { sessionID: sid, error: { name: "APIError", data: {} } } },
      {
        type: "permission.asked",
        properties: { id: "per-1", sessionID: sid, permission: "bash", patterns: [], always: [], metadata: {} },
      },
      { type: "permission.replied", properties: { sessionID: sid, requestID: "per-1", reply: "once" } },
      { type: "question.asked", properties: { id: "que-1", sessionID: sid, questions: [] } },
      { type: "question.replied", properties: { sessionID: sid, requestID: "que-1", answers: [] } },
      { type: "question.rejected", properties: { sessionID: sid, requestID: "que-1" } },
      { type: "suggestion.shown", properties: { id: "sug-1", sessionID: sid, text: "Next", actions: [] } },
      { type: "suggestion.accepted", properties: { sessionID: sid, requestID: "sug-1" } },
      { type: "suggestion.dismissed", properties: { sessionID: sid, requestID: "sug-1" } },
      { type: "session.wakeup", properties: { sessionID: sid, pending: 1 } },
      ...["busy", "retry", "offline", "idle"].map((type) => ({
        type: "session.status",
        properties: { sessionID: sid, status: { type, attempt: 1, message: "", next: 0 } },
      })),
    ]
    sent.length = 0
    for (const event of events) service.emit(event as Event, dir)
    expect(sent.map((message) => message.type)).toEqual([
      "sessionTurnClosed",
      "sessionError",
      "permissionRequest",
      "permissionResolved",
      "questionRequest",
      "questionResolved",
      "questionResolved",
      "suggestionRequest",
      "suggestionResolved",
      "suggestionResolved",
      "sessionWakeup",
      "sessionStatus",
      "sessionStatus",
      "sessionStatus",
      "sessionStatus",
    ])

    // Transcript content and sessions this project does not own stay filtered.
    const count = sent.length
    service.emit(
      { type: "message.part.delta", properties: { sessionID: sid, messageID: "msg-1", partID: "prt-1" } } as Event,
      dir,
    )
    service.emit(
      { type: "session.status", properties: { sessionID: "ses-other", status: { type: "busy" } } } as Event,
      dir,
    )
    expect(sent).toHaveLength(count)
  })

  it("scopes shared session events to the active project directory", () => {
    const service = connection()
    const provider = new KiloProvider({} as never, service as never, undefined, {
      rootDirectory: () => "/repo/project-b",
      projectQualifier: () => ({ projectId: "project-b" }),
    })
    const internal = provider as unknown as Internals
    const sent: unknown[] = []
    const sharedID = "ses-shared"

    internal.webview = {
      postMessage: async (message: unknown) => {
        sent.push(message)
        return true
      },
    }
    internal.isWebviewReady = true
    internal.currentSession = info({ id: sharedID, projectID: "backend-project-b", directory: "/repo/project-b" })
    internal.projectID = "backend-project-a"
    internal.trackedSessionIds.add(sharedID)

    // A background project's event must not overwrite the active project's
    // transcript when both instances expose the same raw session key.
    internal.handleEvent(
      {
        type: "message.updated",
        properties: {
          sessionID: sharedID,
          info: {
            id: "msg-project-a",
            sessionID: sharedID,
            role: "assistant",
            time: { created: 1 },
          },
        },
      } as Event,
      "/repo/project-a",
    )
    expect(sent).toEqual([])

    // Switching projects can briefly leave the backend project identity stale;
    // the active directory is the authoritative scope during that transition.
    internal.handleEvent(
      {
        type: "session.created",
        properties: { sessionID: sharedID, info: internal.currentSession },
      } as Event,
      "/repo/project-b",
    )
    expect(sent).toContainEqual({
      type: "sessionCreated",
      session: {
        id: sharedID,
        title: "Session",
        createdAt: new Date(1).toISOString(),
        updatedAt: new Date(1).toISOString(),
        parentID: null,
        revert: null,
        summary: null,
        goal: null,
      },
    })
  })

  it("refreshes Git from the file path in a completed edit tool part", async () => {
    const service = connection()
    const provider = new KiloProvider({} as never, service as never, undefined, {
      rootDirectory: () => "/workspace",
      projectQualifier: () => ({ projectId: "workspace" }),
    })
    const internal = provider as unknown as Internals
    const dirs: string[] = []
    const refreshed = Promise.withResolvers<void>()
    const sessionID = "ses-edit"
    internal.currentSession = info({ id: sessionID, projectID: "backend-workspace", directory: "/workspace" })
    internal.trackedSessionIds.add(sessionID)
    internal.refreshGitStatus = async (directory) => {
      if (directory) dirs.push(directory)
      refreshed.resolve()
    }

    internal.handleEvent(
      {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            type: "tool",
            tool: "edit",
            state: {
              status: "completed",
              metadata: { filediff: { file: "/workspace/frontend/src/app.ts" } },
            },
          },
        },
      } as Event,
      "/workspace",
    )

    await refreshed.promise
    expect(dirs).toEqual(["/workspace/frontend/src"])
  })

  it("starts standalone stats polling and skips it for embedded providers", async () => {
    const standalone = new KiloProvider({} as never, connection() as never)
    const normal = standalone as unknown as Internals
    normal.startStatsPolling()
    expect(normal.statsPoller).not.toBeNull()
    standalone.dispose()

    const embedded = new KiloProvider({} as never, git() as never, undefined, {
      disableStatsPolling: true,
    })
    const internal = embedded as unknown as Internals
    const sent: unknown[] = []
    let active = "a"
    internal.webview = {
      postMessage: async (message: unknown) => {
        sent.push(message)
        return true
      },
    }
    internal.resolveGitRoot = async () => undefined

    await internal.refreshGitStatus(`/repo/${active}`)
    active = "b"
    await internal.refreshGitStatus(`/repo/${active}`)

    expect(internal.statsPoller).toBeNull()
    expect(sent).toEqual([
      { type: "gitStatus", repo: true },
      { type: "gitStatus", repo: true },
    ])
    embedded.dispose()
  })

  it("ignores completed tool paths outside the active project", async () => {
    const service = connection()
    const provider = new KiloProvider({} as never, service as never, undefined, {
      rootDirectory: () => "/workspace",
      projectQualifier: () => ({ projectId: "workspace" }),
    })
    const internal = provider as unknown as Internals
    const dirs: string[] = []
    const sessionID = "ses-external-edit"
    internal.currentSession = info({ id: sessionID, projectID: "backend-workspace", directory: "/workspace" })
    internal.trackedSessionIds.add(sessionID)
    internal.refreshGitStatus = async (directory) => {
      if (directory) dirs.push(directory)
    }

    const found = await internal.refreshGitStatusFromParts(
      [
        {
          type: "tool",
          tool: "edit",
          state: {
            status: "completed",
            metadata: { filediff: { file: "/other-repo/src/app.ts" } },
          },
        },
      ],
      sessionID,
    )

    expect(found).toBe(false)
    expect(dirs).toEqual([])
  })

  it("ignores subagents before adopting pending follow-up sessions", async () => {
    const service = connection()
    const provider = new KiloProvider({} as never, service as never)
    const internal = provider as unknown as Internals
    const sent: unknown[] = []
    const loaded: string[] = []

    internal.webview = {
      postMessage: async (message: unknown) => {
        sent.push(message)
        return true
      },
    }
    internal.syncWebviewState = async () => {}
    internal.flushPendingSessionRefresh = async () => {}
    internal.fetchAndSendProviders = async () => {}
    internal.fetchAndSendAgents = async () => {}
    internal.fetchAndSendSkills = async () => {}
    internal.fetchAndSendCommands = async () => {}
    internal.fetchAndSendConfig = async () => {}
    internal.fetchAndSendNotifications = async () => {}
    internal.seedSessionStatusMap = async () => {}
    internal.sendNotificationSettings = () => {}
    internal.startStatsPolling = () => {}

    await internal.initializeConnection()
    sent.length = 0

    internal.pendingFollowup = { dir: "/repo", time: Date.now() }
    internal.handleLoadMessages = async (sessionID: string) => {
      loaded.push(sessionID)
    }

    service.emit(created({ id: "ses-child", directory: "/repo", parentID: "ses-parent" }))
    await Promise.resolve()

    expect(internal.currentSession).toBeNull()
    expect(internal.trackedSessionIds.has("ses-child")).toBe(false)
    expect(internal.pendingFollowup).not.toBeNull()
    expect(loaded).toEqual([])
    expect(sent).toEqual([])

    service.emit(created({ id: "ses-followup", directory: "/repo" }))
    await Promise.resolve()

    expect(internal.currentSession?.id).toBe("ses-followup")
    expect(internal.trackedSessionIds.has("ses-followup")).toBe(true)
    expect(loaded).toEqual(["ses-followup"])
    expect(sent).toEqual([
      {
        type: "sessionCreated",
        session: {
          id: "ses-followup",
          title: "Session",
          createdAt: new Date(1).toISOString(),
          updatedAt: new Date(1).toISOString(),
          parentID: null,
          revert: null,
          summary: null,
          goal: null,
        },
        activate: true,
      },
    ])
  })

  it("calls onFollowupAdopted listeners with session and directory", async () => {
    const service = connection()
    const provider = new KiloProvider({} as never, service as never)
    const internal = provider as unknown as Internals
    const adopted: Array<{ id: string; dir: string }> = []

    internal.webview = { postMessage: async () => true }
    internal.syncWebviewState = async () => {}
    internal.flushPendingSessionRefresh = async () => {}
    internal.fetchAndSendProviders = async () => {}
    internal.fetchAndSendAgents = async () => {}
    internal.fetchAndSendSkills = async () => {}
    internal.fetchAndSendCommands = async () => {}
    internal.fetchAndSendConfig = async () => {}
    internal.fetchAndSendNotifications = async () => {}
    internal.seedSessionStatusMap = async () => {}
    internal.sendNotificationSettings = () => {}
    internal.startStatsPolling = () => {}
    internal.handleLoadMessages = async () => {}

    await internal.initializeConnection()

    provider.onFollowupAdopted((session, directory) => {
      adopted.push({ id: session.id, dir: directory })
    })

    internal.pendingFollowup = { dir: "/repo/.kilo/worktrees/feat", time: Date.now() }
    service.emit(created({ id: "ses-wt", directory: "/repo/.kilo/worktrees/feat" }))
    await Promise.resolve()

    expect(adopted).toEqual([{ id: "ses-wt", dir: "/repo/.kilo/worktrees/feat" }])
  })
})
