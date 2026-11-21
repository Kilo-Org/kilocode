import { describe, expect, it } from "bun:test"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type State = "connecting" | "connected" | "disconnected" | "error"

type Internals = {
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  providersRetry: boolean
  providersRefresh: Promise<void> | null
  setProjectDirectory: (directory: string | null) => void
  cachedConfigMessage: unknown
  cachedConfigDirectory: string | null
  cachedProvidersMessage: unknown
  cachedProvidersDirectory: string | null
  storedProviderKeys: Record<string, { key: string; baseURL: string }>
  retryInitialization: () => Promise<void>
  refreshConfig: (type: "configLoaded" | "configUpdated", dir?: string) => Promise<void>
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
  handleProviderAction: (msg: Record<string, unknown>) => Promise<void>
  reloadAfterAuthChange: () => Promise<void>
}

function connection(online: boolean | (() => boolean) = true, custom?: unknown) {
  const up = typeof online === "function" ? online : () => online
  let listener: ((state: State, error?: Error) => void) | undefined
  const client = custom ?? { kilo: { profile: async () => ({ data: null }) } }
  return {
    emitState(next: State) {
      if (!listener) throw new Error("expected a connection state subscription")
      listener(next)
    },
    connect: async () => {},
    getClient: () => {
      if (!up()) throw new Error("Not connected — call connect() first")
      return client as never
    },
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

function provider(service: ReturnType<typeof connection>, root = () => "/repo") {
  return new KiloProvider({} as never, service as never, undefined, {
    rootDirectory: root,
  }) as unknown as Internals
}

function stub(internal: Internals) {
  internal.webview = { postMessage: async () => true }
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
}

function remote(requests: string[]) {
  return {
    kilo: {
      authStatus: async () => ({ data: { authenticated: false } }),
      profile: async () => ({ data: null }),
    },
    provider: {
      list: async (input: { directory: string }) => {
        requests.push(input.directory)
        return { data: { all: [], connected: [], default: { [input.directory]: true } } }
      },
    },
  }
}

function loaded(messages: unknown[]) {
  return messages.filter((message) => (message as { type?: string } | null)?.type === "providersLoaded")
}

describe("KiloProvider providers on reconnect", () => {
  it("recovers providers against the selected project without reconnecting", async () => {
    let dir = "/unavailable"
    const requests: string[] = []
    const messages: unknown[] = []
    const internal = provider(
      connection(true, {
        kilo: { authStatus: async () => ({ data: { authenticated: false } }) },
        provider: {
          list: async (input: { directory: string }) => {
            requests.push(input.directory)
            if (input.directory === "/unavailable") throw new Error("PermissionDenied")
            return { data: { all: [], connected: [], default: {} } }
          },
        },
      }),
      () => dir,
    )
    stub(internal)
    internal.webview = { postMessage: async (message) => messages.push(message) }
    const configs: string[] = []
    internal.fetchAndSendConfig = async () => {
      configs.push(dir)
      internal.cachedConfigMessage = { type: "configLoaded", config: {} }
      internal.cachedConfigDirectory = dir
    }
    await internal.fetchAndSendProviders()
    expect(internal.providersRetry).toBe(true)

    dir = "/healthy"
    await internal.retryInitialization()

    expect(requests).toEqual(["/unavailable", "/healthy"])
    expect(configs).toEqual(["/healthy"])
    expect(internal.providersRetry).toBe(false)
    expect(messages).toContainEqual(expect.objectContaining({ type: "providersLoaded", ready: true }))

    await internal.retryInitialization()
    expect(requests).toHaveLength(2)
    expect(configs).toHaveLength(1)
  })

  it("drops a config snapshot that resolves for a previous project directory", async () => {
    let dir = "/project-a"
    const messages: unknown[] = []
    const internal = provider(
      connection(true, {
        config: {
          get: async () => ({ data: {} }),
          overlay: async () => ({ data: { collections: [] } }),
        },
        global: { config: { get: async () => ({ data: {} }) } },
        experimental: { capabilities: { get: async () => ({ data: { backgroundSubagents: false } }) } },
      }),
      () => dir,
    )
    stub(internal)
    internal.webview = { postMessage: async (message) => messages.push(message) }

    await internal.refreshConfig("configLoaded", "/project-a")
    expect(messages).toContainEqual(expect.objectContaining({ type: "configLoaded" }))
    const published = messages.length

    dir = "/project-b"
    await internal.refreshConfig("configLoaded", "/project-a")

    expect(messages).toHaveLength(published)
  })

  it("marks a retry when providers are fetched without a client", async () => {
    const internal = provider(connection(false))
    stub(internal)

    await internal.fetchAndSendProviders()

    expect(internal.providersRetry).toBe(true)
  })

  it("marks a retry when the provider fetch rejects with a client", async () => {
    const reject = {
      kilo: { authStatus: async () => ({ data: undefined }) },
      provider: {
        list: async () => {
          throw new Error("backend gone")
        },
      },
    }
    const internal = provider(connection(true, reject))
    stub(internal)

    await internal.fetchAndSendProviders()

    expect(internal.providersRetry).toBe(true)
  })

  it("fetches providers on connect when a previous fetch had no client", async () => {
    const service = connection()
    const internal = provider(service)
    let providers = 0
    stub(internal)
    internal.fetchAndSendProviders = async () => {
      providers++
    }
    await internal.initializeConnection()
    internal.providersRetry = true
    const before = providers

    service.emitState("connected")
    await Bun.sleep(0)

    expect(providers).toBe(before + 1)
  })

  it("does not refetch providers on connect when none are pending", async () => {
    const service = connection()
    const internal = provider(service)
    let providers = 0
    stub(internal)
    internal.fetchAndSendProviders = async () => {
      providers++
    }
    await internal.initializeConnection()
    const before = providers

    service.emitState("connected")
    await Bun.sleep(0)

    expect(providers).toBe(before)
  })

  it("keeps the provider view on the active project after a project switch", async () => {
    let dir = "/project-a"
    let online = true
    const requests: string[] = []
    const messages: unknown[] = []
    const internal = provider(
      connection(() => online, remote(requests)),
      () => dir,
    )
    stub(internal)
    internal.webview = { postMessage: async (message) => messages.push(message) }

    await internal.fetchAndSendProviders()
    expect(loaded(messages)).toHaveLength(1)
    expect(requests).toEqual(["/project-a"])

    online = false
    dir = "/project-b"
    internal.setProjectDirectory("/project-b")
    const before = messages.length

    await internal.fetchAndSendProviders()

    expect(loaded(messages.slice(before))).toHaveLength(0)
    expect(internal.providersRetry).toBe(true)
  })

  it("publishes a failure payload when the switch fetch fails", async () => {
    let dir = "/project-a"
    const requests: string[] = []
    const messages: unknown[] = []
    const client = remote(requests)
    const internal = provider(connection(true, client), () => dir)
    stub(internal)
    internal.webview = { postMessage: async (message) => messages.push(message) }

    await internal.fetchAndSendProviders()
    expect(loaded(messages)).toHaveLength(1)
    internal.storedProviderKeys = { example: { key: "example", baseURL: "https://example.test" } }

    dir = "/project-b"
    client.provider.list = async (input: { directory: string }) => {
      requests.push(input.directory)
      throw new Error("backend gone")
    }
    internal.setProjectDirectory("/project-b")
    if (internal.providersRefresh) await internal.providersRefresh

    expect(internal.providersRetry).toBe(true)
    const types = messages.map((message) => (message as { type?: string }).type)
    expect(types).toContain("providersReset")
    expect(internal.storedProviderKeys).toEqual({})
    const last = messages.at(-1) as Record<string, unknown>
    expect(last).toMatchObject({
      type: "providersLoaded",
      providers: {},
      connected: [],
      defaults: {},
      ready: false,
    })
    expect(last).toMatchObject({ loadFailed: true })
    expect(internal.cachedProvidersMessage).toBeNull()
  })

  it("keeps the current project's payload when a refresh fails", async () => {
    const dir = "/project-a"
    const requests: string[] = []
    const messages: unknown[] = []
    const client = remote(requests)
    const internal = provider(connection(true, client), () => dir)
    stub(internal)
    internal.webview = { postMessage: async (message) => messages.push(message) }

    await internal.fetchAndSendProviders()
    const retained = internal.cachedProvidersMessage
    expect(retained).not.toBeNull()
    const before = messages.length

    client.provider.list = async () => {
      throw new Error("backend gone")
    }
    await internal.fetchAndSendProviders()

    expect(loaded(messages.slice(before))).toHaveLength(0)
    expect(messages.at(-1)).toBe(retained)
    expect(internal.cachedProvidersMessage).toBe(retained)
    expect(internal.providersRetry).toBe(true)
  })

  it("keeps the stored provider key when the same project refreshes", async () => {
    const requests: string[] = []
    const internal = provider(connection(true, remote(requests)), () => "/project-a")
    stub(internal)
    internal.storedProviderKeys = { custom: { key: "secret", baseURL: "https://example.test" } }
    // A same-project refresh runs in two steps: the invalidation, then the read. This test checks the
    // saved keys after the first step, so the read is held back and cannot mask the result.
    internal.fetchAndSendProviders = async () => {}

    await internal.reloadAfterAuthChange()

    expect(internal.storedProviderKeys).toEqual({ custom: { key: "secret", baseURL: "https://example.test" } })
  })

  it("sends the new project's provider payload on the next connection", async () => {
    let dir = "/project-a"
    let online = true
    const requests: string[] = []
    const messages: unknown[] = []
    const service = connection(() => online, remote(requests))
    const internal = provider(service, () => dir)
    stub(internal)
    internal.webview = { postMessage: async (message) => messages.push(message) }

    await internal.fetchAndSendProviders()
    online = false
    dir = "/project-b"
    internal.setProjectDirectory("/project-b")
    const before = messages.length

    await internal.initializeConnection()
    online = true
    service.emitState("connected")
    if (internal.providersRefresh) await internal.providersRefresh

    expect(requests.at(-1)).toBe("/project-b")
    expect(loaded(messages.slice(before))).toHaveLength(1)
  })

  it("fetches providers for the project a retained panel switched to", async () => {
    let dir = "/project-a"
    const requests: string[] = []
    const messages: unknown[] = []
    const internal = provider(connection(true, remote(requests)), () => dir)
    stub(internal)
    internal.webview = { postMessage: async (message) => messages.push(message) }

    await internal.fetchAndSendProviders()
    const before = messages.length

    dir = "/project-b"
    internal.setProjectDirectory("/project-b")
    if (internal.providersRefresh) await internal.providersRefresh

    expect(requests).toEqual(["/project-a", "/project-b"])
    expect(loaded(messages.slice(before))).toHaveLength(1)
  })

  it("loads the provider view for the project a settings panel selected", async () => {
    const requests: string[] = []
    const messages: unknown[] = []
    const internal = new KiloProvider({} as never, connection(true, remote(requests)) as never, undefined, {
      rootDirectory: () => "/repo",
      projectDirectory: "/repo/packages/app",
    }) as unknown as Internals
    stub(internal)
    internal.webview = { postMessage: async (message) => messages.push(message) }

    await internal.fetchAndSendProviders()
    expect(requests).toEqual(["/repo/packages/app"])

    const before = messages.length
    internal.setProjectDirectory("/repo/packages/other")
    if (internal.providersRefresh) await internal.providersRefresh

    expect(requests).toEqual(["/repo/packages/app", "/repo/packages/other"])
    const after = loaded(messages.slice(before))
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ defaults: { "/repo/packages/other": true } })
  })

  it("runs provider actions against the project the panel shows", async () => {
    const inputs: unknown[] = []
    const custom = {
      kilo: { authStatus: async () => ({ data: { authenticated: false } }) },
      provider: { list: async () => ({ data: { all: [], connected: [], default: {} } }) },
      config: {
        get: async (input: unknown) => {
          inputs.push(input)
          return { data: {} }
        },
      },
      global: { config: { get: async () => ({ data: {} }) }, dispose: async () => {} },
      auth: { remove: async () => ({ data: true }) },
    }
    const messages: unknown[] = []
    const internal = new KiloProvider({} as never, connection(true, custom) as never, undefined, {
      rootDirectory: () => "/repo",
      projectDirectory: "/repo/packages/app",
    }) as unknown as Internals
    stub(internal)
    internal.webview = { postMessage: async (message) => messages.push(message) }

    await internal.handleProviderAction({ type: "disconnectProvider", requestId: "r1", providerID: "vercel" })

    expect(inputs).toContainEqual({ directory: "/repo/packages/app" })
    expect(inputs).not.toContainEqual({ directory: "/repo" })
    expect(messages).toContainEqual(
      expect.objectContaining({ type: "providerDisconnected", requestId: "r1", providerID: "vercel" }),
    )
  })

  it("drops a provider read for the previous project that resolves after a switch", async () => {
    let dir = "/project-a"
    const requests: string[] = []
    const messages: unknown[] = []
    const deferred = Promise.withResolvers<{
      data: { all: unknown[]; connected: string[]; default: Record<string, boolean> }
    }>()
    const internal = provider(
      connection(true, {
        kilo: { authStatus: async () => ({ data: { authenticated: false } }) },
        provider: {
          list: (input: { directory: string }) => {
            requests.push(input.directory)
            if (input.directory === "/project-a") return deferred.promise
            return Promise.resolve({ data: { all: [], connected: [], default: { [input.directory]: true } } })
          },
        },
      }),
      () => dir,
    )
    stub(internal)
    internal.webview = { postMessage: async (message) => messages.push(message) }

    const pending = internal.fetchAndSendProviders()
    expect(requests).toEqual(["/project-a"])

    dir = "/project-b"
    const before = messages.length
    internal.setProjectDirectory("/project-b")
    deferred.resolve({ data: { all: [], connected: [], default: { "/project-a": true } } })
    await pending
    if (internal.providersRefresh) await internal.providersRefresh

    expect(requests).toEqual(["/project-a", "/project-b"])
    expect(loaded(messages)).not.toContainEqual(expect.objectContaining({ defaults: { "/project-a": true } }))
    expect(messages.slice(before)).toContainEqual(expect.objectContaining({ type: "providersReset" }))
    const after = loaded(messages.slice(before))
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ defaults: { "/project-b": true } })
    const cached = internal.cachedProvidersMessage
    if (cached) expect(cached).toMatchObject({ defaults: { "/project-b": true } })
  })

  it("drops a provider read for the previous project that rejects after a switch", async () => {
    let dir = "/project-a"
    const requests: string[] = []
    const messages: unknown[] = []
    const deferred = Promise.withResolvers<{
      data: { all: unknown[]; connected: string[]; default: Record<string, boolean> }
    }>()
    const internal = provider(
      connection(true, {
        kilo: { authStatus: async () => ({ data: { authenticated: false } }) },
        provider: {
          list: (input: { directory: string }) => {
            requests.push(input.directory)
            if (input.directory === "/project-a") return deferred.promise
            return Promise.resolve({ data: { all: [], connected: [], default: { [input.directory]: true } } })
          },
        },
      }),
      () => dir,
    )
    stub(internal)
    internal.webview = { postMessage: async (message) => messages.push(message) }

    const pending = internal.fetchAndSendProviders()
    expect(requests).toEqual(["/project-a"])

    dir = "/project-b"
    const before = messages.length
    internal.setProjectDirectory("/project-b")
    deferred.reject(new Error("backend gone"))
    await pending
    if (internal.providersRefresh) await internal.providersRefresh

    expect(requests).toEqual(["/project-a", "/project-b"])
    expect(loaded(messages)).not.toContainEqual(expect.objectContaining({ defaults: { "/project-a": true } }))
    const after = loaded(messages.slice(before))
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ defaults: { "/project-b": true } })
    expect(after).not.toContainEqual(expect.objectContaining({ loadFailed: true }))
    expect(internal.providersRetry).toBe(false)
    const cached = internal.cachedProvidersMessage
    if (cached) expect(cached).toMatchObject({ defaults: { "/project-b": true } })
  })
})
