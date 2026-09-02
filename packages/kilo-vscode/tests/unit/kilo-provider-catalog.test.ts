import { describe, expect, it } from "bun:test"

const { KiloProvider } = await import("../../src/KiloProvider")

const catalog = (org: string) => ({
  data: {
    all: [{ id: "kilo", name: "Kilo Gateway", models: { [`${org}/model`]: { id: `${org}/model` } } }],
    connected: ["kilo"],
    default: { kilo: "kilo-auto/free" },
  },
})

type Internals = {
  connectionState: string
  cachedProvidersMessage: unknown
  fetchAndSendProviders(): Promise<void>
  invalidateProviders(): void
}

function setup(list: () => Promise<ReturnType<typeof catalog>>, org: () => string) {
  const client = {
    provider: { list, auth: async () => ({ data: {} }) },
    kilo: { authStatus: async () => ({ data: { authenticated: true, type: "oauth", organizationId: org() } }) },
    config: { providers: async () => ({ data: { default: { kilo: `${org()}/model` } } }) },
  }
  const provider = new KiloProvider({} as never, { getClient: () => client } as never)
  const internal = provider as unknown as Internals
  internal.connectionState = "connected"
  const messages: Array<Record<string, unknown>> = []
  provider.postMessage = (message) => void messages.push(message as Record<string, unknown>)
  return { internal, messages }
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
