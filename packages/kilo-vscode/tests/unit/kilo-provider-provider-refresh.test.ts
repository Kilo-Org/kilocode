import { describe, expect, it } from "bun:test"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type State = "connecting" | "connected" | "disconnected" | "error"

type Internals = {
  cachedProvidersMessage: unknown
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  initializeConnection: () => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  fetchAndSendIndexingStatus: (directory?: string, projectId?: string) => void
  flushPendingKiloModel: () => void
  checkConfigWarnings: (reason: string) => Promise<void>
  syncWebviewState: (reason: string) => Promise<void>
  flushPendingSessionRefresh: (reason: string) => Promise<void>
  recoverPendingPrompts: () => void
  fetchAndSendAgents: () => Promise<void>
  fetchAndSendSkills: () => Promise<void>
  fetchAndSendCommands: () => Promise<void>
  fetchAndSendConfig: () => Promise<void>
  fetchAndSendNotifications: () => Promise<void>
  seedSessionStatusMap: () => Promise<void>
  sendNotificationSettings: () => void
  startStatsPolling: () => void
}

function connection() {
  let listener: ((state: State, error?: Error) => void) | undefined
  const client = { kilo: { profile: async () => ({ data: null }) } }
  return {
    emitState(next: State) {
      if (!listener) throw new Error("expected a connection state subscription")
      listener(next)
    },
    connect: async () => {},
    getClient: () => client as never,
    onEventFiltered: () => () => undefined,
    onStateChange: (next: typeof listener) => {
      listener = next
      return () => undefined
    },
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
  }
}

describe("KiloProvider providers on reconnect", () => {
  async function setup() {
    const service = connection()
    const provider = new KiloProvider({} as never, service as never, undefined, {
      projectDirectory: "/repo",
      rootDirectory: () => "/repo",
    })
    const internal = provider as unknown as Internals
    const counter = { providers: 0 }
    internal.webview = { postMessage: async () => true }
    internal.fetchAndSendProviders = async () => {
      counter.providers++
    }
    internal.fetchAndSendIndexingStatus = () => {}
    internal.flushPendingKiloModel = () => {}
    internal.checkConfigWarnings = async () => {}
    internal.syncWebviewState = async () => {}
    internal.flushPendingSessionRefresh = async () => {}
    internal.recoverPendingPrompts = () => {}
    internal.fetchAndSendAgents = async () => {}
    internal.fetchAndSendSkills = async () => {}
    internal.fetchAndSendCommands = async () => {}
    internal.fetchAndSendConfig = async () => {}
    internal.fetchAndSendNotifications = async () => {}
    internal.seedSessionStatusMap = async () => {}
    internal.sendNotificationSettings = () => {}
    internal.startStatsPolling = () => {}
    await internal.initializeConnection()
    return { service, internal, counter }
  }

  it("fetches providers on connect when no provider list was loaded", async () => {
    const test = await setup()
    const before = test.counter.providers

    test.service.emitState("connected")
    await Bun.sleep(0)

    expect(test.counter.providers).toBe(before + 1)
  })

  it("does not refetch providers on reconnect when they are already loaded", async () => {
    const test = await setup()
    test.internal.cachedProvidersMessage = { type: "providersLoaded" }
    const before = test.counter.providers

    test.service.emitState("connected")
    await Bun.sleep(0)

    expect(test.counter.providers).toBe(before)
  })
})
