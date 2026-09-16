import { describe, expect, it } from "bun:test"
import type { Config } from "@kilocode/sdk/v2/client"
import type { AuthContext } from "../../src/kilo-provider/handlers/auth"

const { KiloProvider } = await import("../../src/KiloProvider")

const external = { id: "external", name: "External", models: { model: { id: "model" } } }
const catalog = (org: string) => ({
  data: {
    all: [
      {
        id: "kilo",
        name: "Kilo Gateway",
        models: { [`${org}/first`]: { id: `${org}/first` }, [`${org}/model`]: { id: `${org}/model` } },
      },
      external,
    ],
    connected: ["kilo", "external"],
    default: { kilo: `${org}/model`, external: "model" },
  },
})

type Internals = {
  connectionState: string
  cachedConfigMessage: unknown
  cachedProvidersMessage: unknown
  providersRefresh: Promise<void> | null
  authCtx: AuthContext
  fetchAndSendProviders(): Promise<void>
  invalidateProviders(): void
  handleEvent(event: unknown, directory?: string): void
  reloadAfterAuthChange(): Promise<void>
}

function setup(list: () => Promise<ReturnType<typeof catalog>>, org: () => string) {
  const client = {
    provider: { list, auth: async () => ({ data: {} }) },
    kilo: { authStatus: async () => ({ data: { authenticated: true, type: "oauth", organizationId: org() } }) },
    config: {
      get: async (): Promise<{ data: Config }> => ({ data: {} }),
      overlay: async () => ({ data: {} }),
    },
    global: { config: { get: async () => ({ data: {} }) } },
    experimental: { capabilities: { get: async () => ({ data: {} }) } },
  }
  const provider = new KiloProvider(
    {} as never,
    { getClient: () => client, resolveEventSessionId: () => undefined } as never,
  )
  const internal = provider as unknown as Internals
  Object.assign(internal, {
    connectionState: "connected",
    fetchAndSendAgents: async () => {},
    fetchAndSendSkills: async () => {},
    fetchAndSendCommands: async () => {},
    fetchAndSendIndexingStatus: async () => {},
    fetchAndSendNotifications: async () => {},
  })
  const reloads: Promise<void>[] = []
  const reload = internal.reloadAfterAuthChange.bind(internal)
  internal.reloadAfterAuthChange = () => {
    const task = reload()
    reloads.push(task)
    return task
  }
  const messages: Array<Record<string, unknown>> = []
  provider.postMessage = (message) => void messages.push(message as Record<string, unknown>)
  return { internal, messages, client, reloads }
}

describe("KiloProvider catalog refresh", () => {
  it("invalidates cached Kilo data before another account refresh", async () => {
    const { internal, messages } = setup(
      async () => catalog("org"),
      () => "org",
    )
    await internal.fetchAndSendProviders()
    expect(internal.cachedProvidersMessage).toMatchObject({ organizationId: "org", ready: true })

    internal.invalidateProviders()

    expect(internal.cachedProvidersMessage).toBeNull()
    expect(messages.at(-1)).toEqual({ type: "providersLoading" })
  })

  it("publishes only the newest catalog and recommendation after a queued switch", async () => {
    const first = Promise.withResolvers<ReturnType<typeof catalog>>()
    const started = Promise.withResolvers<void>()
    let org = "a"
    let calls = 0
    const { internal, messages } = setup(
      async () => {
        calls++
        if (calls !== 1) return catalog(org)
        started.resolve()
        return first.promise
      },
      () => org,
    )

    const before = internal.fetchAndSendProviders()
    await started.promise
    org = "b"
    const after = internal.fetchAndSendProviders()
    first.resolve(catalog("a"))
    await Promise.all([before, after])

    expect(calls).toBe(2)
    expect(messages).toHaveLength(1)
    expect(messages.at(0)).toMatchObject({
      type: "providersLoaded",
      organizationId: "b",
      ready: true,
      defaults: { kilo: "b/model" },
      providers: { kilo: { models: { "b/model": { id: "b/model" } } } },
    })
  })

  it.each([false, true])("preserves a queued refresh through auth invalidation (failure: %s)", async (fail) => {
    const first = Promise.withResolvers<ReturnType<typeof catalog>>()
    let org = "a"
    let calls = 0
    const { internal, messages } = setup(
      async () => (++calls === 1 ? first.promise : catalog(org)),
      () => org,
    )
    const before = internal.fetchAndSendProviders()
    const queued = internal.fetchAndSendProviders()

    org = "b"
    internal.authCtx.invalidateProviders()
    if (fail) first.reject(new Error("Old catalog unavailable"))
    if (!fail) first.resolve(catalog("a"))
    await Promise.all([before, queued])

    expect(calls).toBe(2)
    expect(messages).toHaveLength(2)
    expect(messages.at(0)).toEqual({ type: "providersLoading" })
    expect(messages.at(-1)).toMatchObject({
      type: "providersLoaded",
      organizationId: "b",
      ready: true,
      defaults: { kilo: "b/model" },
      providers: { kilo: { models: { "b/model": { id: "b/model" } } }, external },
    })
  })

  it.each(["global.disposed", "server.instance.disposed"])(
    "%s restores a fresh catalog without waiting for config",
    async (type) => {
      const config = Promise.withResolvers<{ data: Config }>()
      const { internal, messages, client, reloads } = setup(
        async () => catalog("org"),
        () => "org",
      )
      const preference = { model: "external/model" }
      internal.cachedConfigMessage = { config: preference }
      client.config.get = () => config.promise
      await internal.fetchAndSendProviders()
      const fresh = internal.cachedProvidersMessage

      internal.handleEvent(
        { type, properties: { directory: "/repo" } },
        type === "global.disposed" ? "global" : "/repo",
      )
      try {
        expect(messages.at(-1)).toEqual({ type: "providersLoading" })
        expect(internal.providersRefresh).not.toBeNull()
        await internal.providersRefresh

        expect(internal.cachedProvidersMessage).toEqual(fresh)
        expect(messages.at(-1)).toMatchObject({
          type: "providersLoaded",
          ready: true,
          providers: { external },
          defaultSelection: { providerID: "external", modelID: "model" },
        })
        expect(messages.some((message) => message.type === "configLoaded")).toBe(false)
        expect(internal.cachedConfigMessage).toEqual({ config: preference })
      } finally {
        config.resolve({ data: preference })
        await Promise.all(reloads)
      }
      expect(internal.cachedProvidersMessage).toEqual(fresh)
    },
  )

  it("global disposal invalidates every view and retries only the new Org while config is delayed", async () => {
    const config = Promise.withResolvers<{ data: Config }>()
    const first = Promise.withResolvers<ReturnType<typeof catalog>>()
    let org = "a"
    let delayed = false
    const views = Array.from({ length: 2 }, () =>
      setup(
        async () => (delayed && org === "a" ? first.promise : catalog(org)),
        () => org,
      ),
    )
    await Promise.all(views.map((view) => view.internal.fetchAndSendProviders()))
    delayed = true
    const pending = views.map((view) => view.internal.fetchAndSendProviders())
    const queued = views.map((view) => view.internal.fetchAndSendProviders())
    org = "b"
    views.at(0)!.internal.authCtx.invalidateProviders()
    for (const view of views) {
      view.client.config.get = () => config.promise
      view.internal.handleEvent({ type: "global.disposed", properties: {} }, "global")
      expect(view.internal.cachedProvidersMessage).toBeNull()
      expect(view.messages.at(-1)).toEqual({ type: "providersLoading" })
    }
    first.resolve(catalog("a"))
    try {
      await Promise.all([...pending, ...queued])
      for (const view of views) {
        expect(view.messages.filter((message) => message.type === "providersLoaded")).toHaveLength(2)
        expect(view.internal.cachedProvidersMessage).toMatchObject({
          organizationId: "b",
          ready: true,
          defaults: { kilo: "b/model" },
          providers: { kilo: { models: { "b/model": { id: "b/model" } } }, external },
        })
        expect(view.messages.some((message) => message.type === "configLoaded")).toBe(false)
      }
    } finally {
      config.resolve({ data: {} })
      await Promise.all(views.flatMap((view) => view.reloads))
    }
  })

  it("cannot republish an in-flight old catalog after invalidation", async () => {
    const first = Promise.withResolvers<ReturnType<typeof catalog>>()
    const { internal, messages } = setup(
      () => first.promise,
      () => "old",
    )
    const pending = internal.fetchAndSendProviders()

    internal.invalidateProviders()
    first.resolve(catalog("old"))
    await pending

    expect(messages).toEqual([{ type: "providersLoading" }])
    expect(internal.cachedProvidersMessage).toBeNull()
  })

  it("does not restore an old catalog when the new account cannot load", async () => {
    let fail = false
    const { internal, messages } = setup(
      async () => {
        if (fail) throw new Error("Catalog unavailable")
        return catalog("old")
      },
      () => "old",
    )
    await internal.fetchAndSendProviders()
    internal.invalidateProviders()
    fail = true
    await internal.fetchAndSendProviders()

    expect(messages.at(-1)).toEqual({ type: "providersLoading" })
    expect(messages.filter((message) => message.type === "providersLoaded")).toHaveLength(1)
    expect(internal.cachedProvidersMessage).toBeNull()
  })
})
