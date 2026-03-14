import { describe, expect, it } from "bun:test"

const { KiloProvider } = await import("../../src/KiloProvider")

type ProviderAuthState = "api" | "oauth" | "wellknown"

interface ClientOptions {
  providerID: string
  connected: string[]
  authStates?: Record<string, ProviderAuthState>
  authMethods?: Record<string, Array<{ type: "api" | "oauth"; label: string }>>
  authorize?: { url: string; method: "auto" | "code"; instructions: string }
  failSet?: unknown
  config?: Record<string, unknown>
  globalConfig?: Record<string, unknown>
}

function createClient(options: ClientOptions) {
  const calls = {
    set: [] as unknown[],
    remove: [] as unknown[],
    authorize: [] as unknown[],
    callback: [] as unknown[],
    dispose: 0,
    updateConfig: [] as unknown[],
    getConfig: 0,
    getGlobalConfig: 0,
    order: [] as string[],
  }

  const connected = [...options.connected]
  const authStates = { ...(options.authStates ?? {}) }
  const configState = { ...(options.config ?? {}) }
  const globalConfigState = { ...(options.globalConfig ?? options.config ?? {}) }

  function all() {
    const configured = Object.entries(
      (globalConfigState.provider as Record<string, Record<string, unknown>> | undefined) ?? {},
    ).map(([id, provider]) => ({
      id,
      name: String(provider.name ?? id),
      source: "custom" as const,
      env: Array.isArray(provider.env) ? provider.env : [],
      options: {},
      models: (provider.models as Record<string, unknown>) ?? {},
    }))

    const base = {
      id: options.providerID,
      name: options.providerID,
      source: authStates[options.providerID] === "api" ? "api" : "custom",
      env: [],
      options: {},
      models: {},
    }

    return [base, ...configured.filter((provider) => provider.id !== options.providerID)]
  }

  return {
    calls,
    auth: {
      set: async (params: unknown) => {
        calls.set.push(params)
        calls.order.push("set")
        if (options.failSet) throw options.failSet
        const payload = params as { providerID: string }
        authStates[payload.providerID] = "api"
        if (!connected.includes(payload.providerID)) connected.push(payload.providerID)
        return { data: true }
      },
      remove: async (params: unknown) => {
        calls.remove.push(params)
        calls.order.push("remove")
        const payload = params as { providerID: string }
        delete authStates[payload.providerID]
        const index = connected.indexOf(payload.providerID)
        if (index >= 0) connected.splice(index, 1)
        return { data: true }
      },
      list: async () => ({ data: authStates }),
    },
    provider: {
      list: async () => ({ data: { all: all(), connected, default: {} } }),
      auth: async () => ({ data: options.authMethods ?? {} }),
      oauth: {
        authorize: async (params: unknown) => {
          calls.authorize.push(params)
          return {
            data: options.authorize ?? { url: "https://example.com", method: "code", instructions: "Code: 1234" },
          }
        },
        callback: async (params: unknown) => {
          calls.callback.push(params)
          return { data: true }
        },
      },
    },
    global: {
      dispose: async () => {
        calls.dispose += 1
        return { data: true }
      },
      config: {
        get: async () => {
          calls.getGlobalConfig += 1
          calls.order.push("getGlobalConfig")
          return { data: globalConfigState }
        },
        update: async (params: { config: Record<string, unknown> }) => {
          calls.updateConfig.push(params)
          calls.order.push("updateConfig")
          if (params.config.provider && typeof params.config.provider === "object") {
            globalConfigState.provider = {
              ...((globalConfigState.provider as Record<string, unknown>) ?? {}),
              ...(params.config.provider as Record<string, unknown>),
            }
          }
          if (params.config.disabled_providers !== undefined) {
            globalConfigState.disabled_providers = params.config.disabled_providers
          }
          return { data: globalConfigState }
        },
      },
    },
    app: {
      agents: async () => ({ data: [] }),
    },
    config: {
      get: async () => {
        calls.getConfig += 1
        calls.order.push("getConfig")
        return { data: configState }
      },
    },
    kilo: {
      notifications: async () => ({ data: [] }),
      profile: async () => ({ data: {} }),
    },
  }
}

function createConnection(client: ReturnType<typeof createClient>) {
  return {
    getClient: () => client,
    connect: async () => undefined,
    onEventFiltered: () => () => undefined,
    onStateChange: () => () => undefined,
    onNotificationDismissed: () => () => undefined,
    getServerInfo: () => ({ port: 12345 }),
    getConnectionState: () => "connected" as const,
    resolveEventSessionId: () => undefined,
    recordMessageSessionId: () => undefined,
    notifyNotificationDismissed: () => undefined,
  }
}

function createWebview() {
  const sent: unknown[] = []
  let listener: ((message: Record<string, unknown>) => Promise<void>) | undefined

  return {
    sent,
    async receive(message: Record<string, unknown>) {
      if (!listener) throw new Error("listener missing")
      await listener(message)
    },
    postMessage: async (message: unknown) => {
      sent.push(message)
    },
    onDidReceiveMessage: (cb: (message: Record<string, unknown>) => Promise<void>) => {
      listener = cb
      return { dispose() {} }
    },
  }
}

function createBoundProvider(client: ReturnType<typeof createClient>) {
  const provider = new KiloProvider({} as never, createConnection(client) as never)
  const webview = createWebview()
  ;(provider as any).webview = webview
  ;(provider as any).setupWebviewMessageHandler(webview)
  return { provider, webview }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type ProviderListResult = {
  data: {
    all: Array<{
      id: string
      name: string
      source: "custom"
      env: string[]
      options: {}
      models: Record<string, unknown>
    }>
    connected: string[]
    default: {}
  }
}

describe("KiloProvider provider actions", () => {
  it("handles connectProvider and refreshes provider auth state", async () => {
    const client = createClient({
      providerID: "openrouter",
      connected: ["openrouter"],
      authStates: { openrouter: "api" },
    })
    const { webview } = createBoundProvider(client)

    await webview.receive({ type: "connectProvider", requestId: "req-1", providerID: "openrouter", apiKey: "sk-test" })

    expect(client.calls.set).toEqual([
      {
        providerID: "openrouter",
        auth: { type: "api", key: "sk-test" },
      },
    ])
    expect(client.calls.dispose).toBe(1)
    expect(webview.sent).toContainEqual({ type: "providerConnected", requestId: "req-1", providerID: "openrouter" })
    expect(webview.sent).toContainEqual(
      expect.objectContaining({
        type: "providersLoaded",
        authStates: { openrouter: "api" },
      }),
    )
  })

  it("handles authorizeProviderOAuth", async () => {
    const client = createClient({
      providerID: "anthropic",
      connected: [],
      authMethods: { anthropic: [{ type: "oauth", label: "Claude Max" }] },
      authorize: { url: "https://auth.example", method: "code", instructions: "Code: 1234" },
    })
    const { webview } = createBoundProvider(client)

    await webview.receive({ type: "authorizeProviderOAuth", requestId: "req-2", providerID: "anthropic", method: 0 })

    expect(client.calls.authorize).toEqual([{ providerID: "anthropic", method: 0, directory: "/repo" }])
    expect(webview.sent).toContainEqual({
      type: "providerOAuthReady",
      requestId: "req-2",
      providerID: "anthropic",
      authorization: { url: "https://auth.example", method: "code", instructions: "Code: 1234" },
    })
  })

  it("handles completeProviderOAuth and refreshes provider auth state", async () => {
    const client = createClient({
      providerID: "anthropic",
      connected: ["anthropic"],
      authStates: { anthropic: "oauth" },
      authMethods: { anthropic: [{ type: "oauth", label: "Claude Max" }] },
    })
    const { webview } = createBoundProvider(client)

    await webview.receive({
      type: "completeProviderOAuth",
      requestId: "req-3",
      providerID: "anthropic",
      method: 0,
      code: "oauth-code",
    })

    expect(client.calls.callback).toEqual([
      { providerID: "anthropic", method: 0, code: "oauth-code", directory: "/repo" },
    ])
    expect(client.calls.dispose).toBe(1)
    expect(webview.sent).toContainEqual({ type: "providerConnected", requestId: "req-3", providerID: "anthropic" })
    expect(webview.sent).toContainEqual(
      expect.objectContaining({
        type: "providersLoaded",
        authStates: { anthropic: "oauth" },
      }),
    )
  })

  it("handles disconnectProvider and refreshes provider auth state", async () => {
    const client = createClient({ providerID: "openrouter", connected: [], authStates: {} })
    const { webview } = createBoundProvider(client)

    await webview.receive({ type: "disconnectProvider", requestId: "req-4", providerID: "openrouter" })

    expect(client.calls.remove).toEqual([{ providerID: "openrouter" }])
    expect(client.calls.dispose).toBe(1)
    expect(webview.sent).toContainEqual({ type: "providerDisconnected", requestId: "req-4", providerID: "openrouter" })
    expect(webview.sent).toContainEqual(
      expect.objectContaining({
        type: "providersLoaded",
        connected: [],
      }),
    )
  })

  it("posts providerActionError when connectProvider fails", async () => {
    const client = createClient({
      providerID: "openrouter",
      connected: [],
      failSet: new Error("boom"),
    })
    const { webview } = createBoundProvider(client)

    await webview.receive({ type: "connectProvider", requestId: "req-5", providerID: "openrouter", apiKey: "sk-test" })

    expect(webview.sent).toContainEqual({
      type: "providerActionError",
      requestId: "req-5",
      providerID: "openrouter",
      action: "connect",
      message: "boom",
    })
  })

  it("saves custom providers and refreshes provider state", async () => {
    const client = createClient({
      providerID: "openrouter",
      connected: [],
      config: { disabled_providers: ["workspace-only", "myprovider"] },
      globalConfig: { disabled_providers: ["myprovider"] },
    })
    const { webview } = createBoundProvider(client)

    await webview.receive({
      type: "saveCustomProvider",
      requestId: "req-6",
      providerID: "myprovider",
      apiKey: "sk-custom",
      config: {
        npm: "malicious-package",
        name: "My Provider",
        env: ["MY_PROVIDER_KEY"],
        options: {
          baseURL: "https://example.com/v1",
          headers: { Authorization: "Bearer test" },
        },
        models: { "model-1": { name: "Model One" } },
      },
    })

    expect(client.calls.set).toContainEqual({
      providerID: "myprovider",
      auth: { type: "api", key: "sk-custom" },
    })
    expect(client.calls.getGlobalConfig).toBe(1)
    expect(client.calls.getConfig).toBe(0)
    expect(client.calls.order.indexOf("updateConfig")).toBeLessThan(client.calls.order.indexOf("set"))
    expect(client.calls.updateConfig).toContainEqual({
      config: {
        provider: {
          myprovider: {
            npm: "@ai-sdk/openai-compatible",
            name: "My Provider",
            env: ["MY_PROVIDER_KEY"],
            options: {
              baseURL: "https://example.com/v1",
              headers: { Authorization: "Bearer test" },
            },
            models: { "model-1": { name: "Model One" } },
          },
        },
        disabled_providers: [],
      },
    })
    expect(webview.sent).toContainEqual({ type: "providerConnected", requestId: "req-6", providerID: "myprovider" })
    expect(webview.sent).toContainEqual(
      expect.objectContaining({
        type: "configUpdated",
        config: expect.objectContaining({
          provider: expect.objectContaining({
            myprovider: expect.objectContaining({ name: "My Provider" }),
          }),
        }),
      }),
    )
    expect(webview.sent).toContainEqual(
      expect.objectContaining({
        type: "providersLoaded",
        authStates: expect.objectContaining({ myprovider: "api" }),
      }),
    )
  })

  it("refreshes provider state when auth setup fails after saving custom provider config", async () => {
    const client = createClient({
      providerID: "openrouter",
      connected: [],
      failSet: new Error("boom"),
      globalConfig: { disabled_providers: ["myprovider"] },
    })
    const { webview } = createBoundProvider(client)

    await webview.receive({
      type: "saveCustomProvider",
      requestId: "req-6b",
      providerID: "myprovider",
      apiKey: "sk-custom",
      config: {
        name: "My Provider",
        options: {
          baseURL: "https://example.com/v1",
        },
        models: { "model-1": { name: "Model One" } },
      },
    })

    expect(client.calls.getGlobalConfig).toBe(1)
    expect(client.calls.getConfig).toBe(0)
    expect(client.calls.order.indexOf("updateConfig")).toBeLessThan(client.calls.order.indexOf("set"))
    expect(client.calls.updateConfig).toHaveLength(1)
    expect(client.calls.dispose).toBe(1)
    expect(webview.sent).toContainEqual(
      expect.objectContaining({
        type: "configUpdated",
        config: expect.objectContaining({
          provider: expect.objectContaining({
            myprovider: expect.objectContaining({ name: "My Provider" }),
          }),
        }),
      }),
    )
    expect(webview.sent).toContainEqual(
      expect.objectContaining({
        type: "providersLoaded",
        providers: expect.objectContaining({
          myprovider: expect.objectContaining({ name: "My Provider" }),
        }),
      }),
    )
    expect(webview.sent).toContainEqual({
      type: "providerActionError",
      requestId: "req-6b",
      providerID: "myprovider",
      action: "connect",
      message: "boom",
    })
  })

  it("removes stale auth when re-saving a custom provider without an api key", async () => {
    const client = createClient({
      providerID: "openrouter",
      connected: ["myprovider"],
      authStates: { myprovider: "api" },
      globalConfig: { disabled_providers: ["myprovider"] },
    })
    const { webview } = createBoundProvider(client)

    await webview.receive({
      type: "saveCustomProvider",
      requestId: "req-6c",
      providerID: "myprovider",
      config: {
        name: "My Provider",
        env: ["MY_PROVIDER_KEY"],
        options: {
          baseURL: "https://example.com/v1",
        },
        models: { "model-1": { name: "Model One" } },
      },
    })

    expect(client.calls.getGlobalConfig).toBe(1)
    expect(client.calls.getConfig).toBe(0)
    expect(client.calls.order.indexOf("updateConfig")).toBeLessThan(client.calls.order.indexOf("remove"))
    expect(client.calls.remove).toContainEqual({ providerID: "myprovider" })

    const providersLoaded = webview.sent.find((item) => {
      if (!item || typeof item !== "object") return false
      return "type" in item && item.type === "providersLoaded"
    }) as { authStates?: Record<string, ProviderAuthState>; connected?: string[] } | undefined

    expect(providersLoaded?.authStates?.myprovider).toBeUndefined()
    expect(providersLoaded?.connected).not.toContain("myprovider")
  })

  it("rejects invalid provider IDs before forwarding provider actions", async () => {
    const cases = [
      {
        action: "connect" as const,
        message: { type: "connectProvider", requestId: "bad-1", providerID: "bad/id", apiKey: "sk-test" },
      },
      {
        action: "authorize" as const,
        message: { type: "authorizeProviderOAuth", requestId: "bad-2", providerID: "bad/id", method: 0 },
      },
      {
        action: "connect" as const,
        message: {
          type: "completeProviderOAuth",
          requestId: "bad-3",
          providerID: "bad/id",
          method: 0,
          code: "oauth-code",
        },
      },
      {
        action: "disconnect" as const,
        message: { type: "disconnectProvider", requestId: "bad-4", providerID: "bad/id" },
      },
      {
        action: "connect" as const,
        message: {
          type: "saveCustomProvider",
          requestId: "bad-5",
          providerID: "bad/id",
          apiKey: "sk-custom",
          config: {
            npm: "@ai-sdk/openai-compatible",
            name: "My Provider",
            options: { baseURL: "https://example.com/v1" },
            models: { "model-1": { name: "Model One" } },
          },
        },
      },
    ]

    for (const item of cases) {
      const client = createClient({ providerID: "openrouter", connected: [] })
      const { webview } = createBoundProvider(client)

      await webview.receive(item.message)

      expect(client.calls.set).toHaveLength(0)
      expect(client.calls.remove).toHaveLength(0)
      expect(client.calls.authorize).toHaveLength(0)
      expect(client.calls.callback).toHaveLength(0)
      expect(client.calls.updateConfig).toHaveLength(0)
      expect(webview.sent).toContainEqual({
        type: "providerActionError",
        requestId: item.message.requestId,
        providerID: "bad/id",
        action: item.action,
        message: "Invalid provider ID",
      })
    }
  })

  it("rejects custom provider config with unknown fields", async () => {
    const client = createClient({ providerID: "openrouter", connected: [] })
    const { webview } = createBoundProvider(client)

    await webview.receive({
      type: "saveCustomProvider",
      requestId: "req-7",
      providerID: "safeprovider",
      config: {
        name: "Bad Provider",
        options: {
          baseURL: "https://example.com/v1",
          mcpServer: "https://malicious.example",
        },
        models: { "model-1": { name: "Model One" } },
      },
    })

    expect(client.calls.updateConfig).toHaveLength(0)
    expect(webview.sent).toContainEqual(
      expect.objectContaining({
        type: "providerActionError",
        requestId: "req-7",
        providerID: "safeprovider",
        action: "connect",
        message: expect.stringContaining("mcpServer"),
      }),
    )
  })

  it("drops stale provider refreshes when a newer refresh is queued", async () => {
    const client = createClient({ providerID: "openrouter", connected: [] })
    const first = deferred<ProviderListResult>()
    const second = deferred<ProviderListResult>()
    const calls: string[] = []

    client.provider.list = async () => {
      if (calls.length === 0) {
        calls.push("openai")
        return first.promise
      }

      calls.push("google")
      return second.promise
    }

    const { provider, webview } = createBoundProvider(client)
    const target = provider as unknown as { fetchAndSendProviders: () => Promise<void> }

    const early = target.fetchAndSendProviders()
    const late = target.fetchAndSendProviders()

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(["openai"])

    first.resolve({
      data: {
        all: [
          {
            id: "openai",
            name: "OpenAI",
            source: "custom",
            env: [],
            options: {},
            models: { gpt: { id: "gpt", name: "GPT" } },
          },
        ],
        connected: ["openai"],
        default: {},
      },
    })

    second.resolve({
      data: {
        all: [
          {
            id: "google",
            name: "Google",
            source: "custom",
            env: [],
            options: {},
            models: { gemini: { id: "gemini", name: "Gemini" } },
          },
        ],
        connected: ["google"],
        default: {},
      },
    })

    await Promise.all([early, late])

    expect(calls).toEqual(["openai", "google"])

    const messages = webview.sent.filter((item) => {
      if (!item || typeof item !== "object") return false
      return "type" in item && item.type === "providersLoaded"
    }) as Array<{ connected: string[]; providers: Record<string, unknown> }>

    expect(messages).toHaveLength(1)
    expect(messages[0]?.connected).toEqual(["google"])
    expect(Object.keys(messages[0]?.providers ?? {})).toEqual(["google"])
  })
})
