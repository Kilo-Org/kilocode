import { describe, it, expect } from "bun:test"
import { loadSessions, flushPendingSessionRefresh, type SessionRefreshContext } from "../../src/kilo-provider-utils"
import * as vscode from "vscode"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type State = "connecting" | "connected" | "disconnected" | "error"

type ProviderInternals = {
  connectionState: State
  pendingSessionRefresh: boolean
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  initializeConnection: () => Promise<void>
  handleLoadSessions: () => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  postMessage: (message: unknown) => void
}

type ProviderData = {
  all: Array<{
    id: string
    name: string
    env: string[]
    models: Record<
      string,
      {
        id: string
        name: string
        release_date: string
        attachment: boolean
        reasoning: boolean
        temperature: boolean
        tool_call: boolean
        limit: { context: number; output: number }
        options: Record<string, unknown>
      }
    >
  }>
  connected: string[]
  default: Record<string, string>
}

type ConfigValue = {
  defaultValue?: string
  globalValue?: string
  workspaceValue?: string
  workspaceFolderValue?: string
  globalLanguageValue?: string
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

function createProvider(id: string, models: string[]) {
  return {
    id,
    name: id,
    env: [],
    models: Object.fromEntries(
      models.map((modelID) => [
        modelID,
        {
          id: modelID,
          name: modelID,
          release_date: "2026-01-01",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          limit: { context: 1, output: 1 },
          options: {},
        },
      ]),
    ),
  }
}

function createClient(providerData?: ProviderData) {
  const calls: string[] = []
  const data = providerData ?? {
    all: [createProvider("openai", ["gpt-5"])],
    connected: [],
    default: { openai: "gpt-5" },
  }

  return {
    calls,
    session: {
      list: async (params: { directory: string }) => {
        calls.push(params.directory)
        return { data: [] }
      },
    },
    provider: {
      list: async () => ({ data }),
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
    getServerInfo: () => ({ port: 12345 }),
    getConnectionState: () => "connected" as const,
    resolveEventSessionId: () => undefined,
    recordMessageSessionId: () => undefined,
    notifyNotificationDismissed: () => undefined,
  }
}

function setModelConfig(values?: { providerID?: ConfigValue; modelID?: ConfigValue }) {
  const getConfiguration = vscode.workspace.getConfiguration as unknown as (section?: string) => {
    get: <T>(key: string) => T | undefined
    inspect: <T>(key: string) => {
      key: string
      defaultValue?: T
      globalValue?: T
      workspaceValue?: T
      workspaceFolderValue?: T
      defaultLanguageValue?: T
      globalLanguageValue?: T
      workspaceLanguageValue?: T
      workspaceFolderLanguageValue?: T
    }
  }
  ;(vscode.workspace.getConfiguration as unknown as typeof getConfiguration) = (section?: string) => {
    if (section !== "kilo-code.new.model") {
      return getConfiguration(section)
    }

    return {
      get: <T>(key: string) => values?.[key as "providerID" | "modelID"]?.defaultValue as T | undefined,
      inspect: <T>(key: string) => ({
        key,
        defaultValue: values?.[key as "providerID" | "modelID"]?.defaultValue as T | undefined,
        globalValue: values?.[key as "providerID" | "modelID"]?.globalValue as T | undefined,
        workspaceValue: values?.[key as "providerID" | "modelID"]?.workspaceValue as T | undefined,
        workspaceFolderValue: values?.[key as "providerID" | "modelID"]?.workspaceFolderValue as T | undefined,
        defaultLanguageValue: undefined as T | undefined,
        globalLanguageValue: values?.[key as "providerID" | "modelID"]?.globalLanguageValue as T | undefined,
        workspaceLanguageValue: undefined as T | undefined,
        workspaceFolderLanguageValue: undefined as T | undefined,
      }),
    }
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

  it("uses backend provider defaults for fresh sessions", async () => {
    setModelConfig()
    const client = createClient()
    const connection = createConnection(client)
    const provider = new KiloProvider({} as never, connection as never)
    const internal = provider as unknown as ProviderInternals
    const sent: unknown[] = []

    await internal.initializeConnection()
    internal.postMessage = (message: unknown) => {
      sent.push(message)
    }

    await internal.fetchAndSendProviders()

    const loaded = sent.find((msg) => {
      return typeof msg === "object" && !!msg && "type" in msg && (msg as { type?: unknown }).type === "providersLoaded"
    }) as { defaultSelection: { providerID: string; modelID: string } } | undefined

    expect(loaded?.defaultSelection).toEqual({ providerID: "openai", modelID: "gpt-5" })
  })

  it("posts providersLoaded when defaults are missing", async () => {
    setModelConfig()
    const client = createClient({
      all: [createProvider("openai", ["gpt-5", "gpt-5-mini"])],
      connected: [],
      default: {},
    })
    const connection = createConnection(client)
    const provider = new KiloProvider({} as never, connection as never)
    const internal = provider as unknown as ProviderInternals
    const sent: unknown[] = []

    await internal.initializeConnection()
    internal.postMessage = (message: unknown) => {
      sent.push(message)
    }

    await internal.fetchAndSendProviders()

    const loaded = sent.find((msg) => {
      return typeof msg === "object" && !!msg && "type" in msg && (msg as { type?: unknown }).type === "providersLoaded"
    }) as { providers: Record<string, unknown>; defaultSelection: { providerID: string; modelID: string } } | undefined

    expect(loaded?.providers.openai).toBeDefined()
    expect(loaded?.defaultSelection).toEqual({ providerID: "openai", modelID: "gpt-5-mini" })
  })

  it("posts providersLoaded and falls back when defaults are stale", async () => {
    setModelConfig()
    const client = createClient({
      all: [createProvider("openai", ["gpt-5"]), createProvider("anthropic", ["claude-sonnet-4"])],
      connected: [],
      default: { kilo: "kilo-auto/frontier", zed: "broken" },
    })
    const connection = createConnection(client)
    const provider = new KiloProvider({} as never, connection as never)
    const internal = provider as unknown as ProviderInternals
    const sent: unknown[] = []

    await internal.initializeConnection()
    internal.postMessage = (message: unknown) => {
      sent.push(message)
    }

    await internal.fetchAndSendProviders()

    const loaded = sent.find((msg) => {
      return typeof msg === "object" && !!msg && "type" in msg && (msg as { type?: unknown }).type === "providersLoaded"
    }) as { providers: Record<string, unknown>; defaultSelection: { providerID: string; modelID: string } } | undefined

    expect(loaded?.providers.openai).toBeDefined()
    expect(loaded?.providers.anthropic).toBeDefined()
    expect(loaded?.defaultSelection).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
  })

  it("fresh installs ignore contributed defaults and use backend fallback", async () => {
    setModelConfig({
      providerID: { defaultValue: "kilo" },
      modelID: { defaultValue: "kilo-auto/frontier" },
    })
    const client = createClient({
      all: [createProvider("openai", ["gpt-5"]), createProvider("anthropic", ["claude-sonnet-4"])],
      connected: [],
      default: { openai: "gpt-5" },
    })
    const connection = createConnection(client)
    const provider = new KiloProvider({} as never, connection as never)
    const internal = provider as unknown as ProviderInternals
    const sent: unknown[] = []

    await internal.initializeConnection()
    internal.postMessage = (message: unknown) => {
      sent.push(message)
    }

    await internal.fetchAndSendProviders()

    const loaded = sent.find((msg) => {
      return typeof msg === "object" && !!msg && "type" in msg && (msg as { type?: unknown }).type === "providersLoaded"
    }) as { defaultSelection: { providerID: string; modelID: string } } | undefined

    expect(loaded?.defaultSelection).toEqual({ providerID: "openai", modelID: "gpt-5" })
  })

  it("uses valid VS Code model settings as the startup override", async () => {
    setModelConfig({
      providerID: { workspaceValue: "anthropic" },
      modelID: { workspaceValue: "claude-sonnet-4" },
    })
    const client = createClient({
      all: [createProvider("openai", ["gpt-5"]), createProvider("anthropic", ["claude-sonnet-4"])],
      connected: [],
      default: { openai: "gpt-5" },
    })
    const connection = createConnection(client)
    const provider = new KiloProvider({} as never, connection as never)
    const internal = provider as unknown as ProviderInternals
    const sent: unknown[] = []

    await internal.initializeConnection()
    internal.postMessage = (message: unknown) => {
      sent.push(message)
    }

    await internal.fetchAndSendProviders()

    const loaded = sent.find((msg) => {
      return typeof msg === "object" && !!msg && "type" in msg && (msg as { type?: unknown }).type === "providersLoaded"
    }) as { defaultSelection: { providerID: string; modelID: string } } | undefined

    expect(loaded?.defaultSelection).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
  })

  it("falls back safely when VS Code model settings are invalid", async () => {
    setModelConfig({
      providerID: { globalValue: "missing" },
      modelID: { globalValue: "missing-model" },
    })
    const client = createClient({
      all: [createProvider("openai", ["gpt-5"]), createProvider("anthropic", ["claude-sonnet-4"])],
      connected: [],
      default: { openai: "gpt-5" },
    })
    const connection = createConnection(client)
    const provider = new KiloProvider({} as never, connection as never)
    const internal = provider as unknown as ProviderInternals
    const sent: unknown[] = []

    await internal.initializeConnection()
    internal.postMessage = (message: unknown) => {
      sent.push(message)
    }

    await internal.fetchAndSendProviders()

    const loaded = sent.find((msg) => {
      return typeof msg === "object" && !!msg && "type" in msg && (msg as { type?: unknown }).type === "providersLoaded"
    }) as { defaultSelection: { providerID: string; modelID: string } } | undefined

    expect(loaded?.defaultSelection).toEqual({ providerID: "openai", modelID: "gpt-5" })
  })
})
