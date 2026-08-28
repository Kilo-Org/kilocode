import { describe, expect, it } from "bun:test"
import type { Event, Session } from "@kilocode/sdk/v2/client"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  trackedSessionIds: Set<string>
  currentSession: Session | null
  projectID: string | undefined
  isWebviewReady: boolean
  pendingFollowup: { dir: string; time: number } | null
  handleLoadMessages: (sessionID: string) => Promise<void>
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
  let filter: ((event: Event) => boolean) | undefined
  let listener: ((event: Event) => void) | undefined

  return {
    emit(event: Event) {
      if (!filter || !listener) throw new Error("expected SSE subscription")
      if (!filter(event)) return
      listener(event)
    },
    connect: async () => {},
    getClient: () => ({}) as never,
    onEventFiltered: (next: (event: Event) => boolean, cb: (event: Event) => void) => {
      filter = next
      listener = cb
      return () => undefined
    },
    onStateChange: () => () => undefined,
    onNotificationDismissed: () => () => undefined,
    onClearPendingPrompts: () => () => undefined,
    onLanguageChanged: () => () => undefined,
    onProfileChanged: () => () => undefined,
    onMigrationComplete: () => () => undefined,
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
  }
}

function git() {
  const service = connection()
  const client = { project: { current: async () => ({ data: { vcs: "git" } }) } }
  return { ...service, getClient: () => client as never }
}

describe("KiloProvider follow-up sessions", () => {
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
