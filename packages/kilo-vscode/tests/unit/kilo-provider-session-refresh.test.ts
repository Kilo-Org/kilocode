import { describe, it, expect, mock } from "bun:test"

const mockVscode = {
  extensions: {
    getExtension: () => ({
      packageJSON: { version: "test" },
    }),
  },
  env: {
    appName: "VS Code",
    language: "en",
    machineId: "machine",
    isTelemetryEnabled: false,
  },
  version: "1.0.0",
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/repo" } }],
    getConfiguration: () => ({
      get: <T>(_key: string, value?: T) => value,
    }),
  },
}

mock.module("vscode", () => mockVscode)

mock.module("../../src/services/autocomplete/shims/FileIgnoreController", () => ({
  FileIgnoreController: class {
    dispose(): void {}
  },
}))

mock.module("../../src/services/autocomplete/chat-autocomplete/handleChatCompletionRequest", () => ({
  handleChatCompletionRequest: async () => undefined,
}))

mock.module("../../src/services/autocomplete/chat-autocomplete/handleChatCompletionAccepted", () => ({
  handleChatCompletionAccepted: async () => undefined,
}))

const telemetry = {
  setProvider: () => undefined,
  capture: () => undefined,
}

mock.module("../../src/services/telemetry", () => ({
  TelemetryProxy: {
    getInstance: () => telemetry,
  },
}))

const { KiloProvider } = await import("../../src/KiloProvider")

type State = "connecting" | "connected" | "disconnected" | "error"

type ProviderInternals = {
  connectionState: State
  pendingSessionRefresh: boolean
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  initializeConnection: () => Promise<void>
  handleLoadSessions: () => Promise<void>
}

function createClient() {
  const calls: string[] = []
  return {
    calls,
    listSessions: async (dir: string) => {
      calls.push(dir)
      return []
    },
    listProviders: async () => ({
      all: {},
      connected: {},
      default: {},
    }),
    listAgents: async () => [],
    getConfig: async () => ({}),
    getNotifications: async () => [],
    getProfile: async () => ({}),
  }
}

function createConnection(client: ReturnType<typeof createClient>) {
  let current: ReturnType<typeof createClient> | null = null
  return {
    connect: async () => {
      current = client
    },
    getHttpClient: () => {
      if (!current) {
        throw new Error("Not connected")
      }
      return current
    },
    onEventFiltered: () => () => undefined,
    onStateChange: (_listener: (state: State) => void) => () => undefined,
    onNotificationDismissed: () => () => undefined,
    getServerInfo: () => ({ port: 12345 }),
    getConnectionState: () => "connected" as const,
    resolveEventSessionId: () => undefined,
    recordMessageSessionId: () => undefined,
    notifyNotificationDismissed: () => undefined,
  }
}

describe("KiloProvider pending session refresh", () => {
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
