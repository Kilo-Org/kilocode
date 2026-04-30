import { describe, expect, it } from "bun:test"
import type { Event, Session } from "@kilocode/sdk/v2/client"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  trackedSessionIds: Set<string>
  currentSession: Session | null
  pendingFollowup: { dir: string; time: number } | null
  handleLoadMessages: (sessionID: string) => Promise<void>
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
}

function created(input: { id: string; directory: string }): Event {
  return {
    type: "session.created",
    properties: {
      info: {
        id: input.id,
        slug: `${input.id}-slug`,
        projectID: "project-1",
        directory: input.directory,
        title: "Session",
        version: "1",
        time: { created: 1, updated: 1 },
      },
    },
  } as Event
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
    registerDirectoryProvider: () => () => undefined,
    getServerInfo: () => ({ port: 12345 }),
    getServerConfig: () => ({ baseUrl: "http://127.0.0.1:12345", password: "test" }),
    getConnectionState: () => "connected" as const,
    resolveEventSessionId: (event: Event) => (event.type === "session.created" ? event.properties.info.id : undefined),
    recordMessageSessionId: () => undefined,
    notifyNotificationDismissed: () => undefined,
  }
}

describe("KiloProvider follow-up sessions", () => {
  it("adopts pending follow-up sessions for single-session views", async () => {
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
        draftID: undefined,
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
