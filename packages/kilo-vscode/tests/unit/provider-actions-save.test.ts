import { describe, expect, it } from "bun:test"
import { fetchProviderData, saveCustomProvider } from "../../src/provider-actions"

type ExistingGlobal = { disabled_providers?: string[]; provider?: Record<string, unknown> }

function createCtx(existing: ExistingGlobal = { disabled_providers: [] }) {
  const calls = {
    set: [] as Array<{ providerID: string; auth: { type: string; key: string } }>,
    remove: [] as Array<{ providerID: string }>,
    posts: [] as unknown[],
    config: [] as Array<{ config: Record<string, unknown> }>,
    cached: [] as unknown[],
    refresh: 0,
    dispose: 0,
  }

  const ctx = {
    client: {
      auth: {
        set: async (input: { providerID: string; auth: { type: string; key: string } }) => {
          calls.set.push(input)
          return { data: true }
        },
        remove: async (input: { providerID: string }) => {
          calls.remove.push(input)
          return { data: true }
        },
      },
      global: {
        config: {
          get: async () => ({ data: existing }),
          update: async (input: { config: Record<string, unknown> }) => {
            calls.config.push(input)
            return { data: input }
          },
        },
      },
    },
    postMessage: (message: unknown) => calls.posts.push(message),
    getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    workspaceDir: "/tmp",
    disposeGlobal: async () => {
      calls.dispose += 1
    },
    fetchAndSendProviders: async () => {
      calls.refresh += 1
    },
  } as unknown as Parameters<typeof saveCustomProvider>[0]

  return {
    calls,
    ctx,
    setCachedConfig: (message: unknown) => calls.cached.push(message),
  }
}

function createProvider() {
  return {
    name: "My Provider",
    options: { baseURL: "https://example.com/v1" },
    models: {
      "model-1": { name: "Model One" },
    },
  }
}

describe("saveCustomProvider", () => {
  it("preserves auth when the api key field is unchanged", async () => {
    const { ctx, calls, setCachedConfig } = createCtx()

    await saveCustomProvider(ctx, "req", "myprovider", createProvider(), undefined, false, null, setCachedConfig)

    expect(calls.set).toHaveLength(0)
    expect(calls.remove).toHaveLength(0)
    expect(calls.refresh).toBe(1)
  })

  it("clears auth when the api key field was intentionally cleared", async () => {
    const { ctx, calls, setCachedConfig } = createCtx()

    await saveCustomProvider(ctx, "req", "myprovider", createProvider(), undefined, true, null, setCachedConfig)

    expect(calls.set).toHaveLength(0)
    expect(calls.remove).toEqual([{ providerID: "myprovider" }])
  })

  it("stores a changed api key", async () => {
    const { ctx, calls, setCachedConfig } = createCtx()

    await saveCustomProvider(ctx, "req", "myprovider", createProvider(), " sk-test ", true, null, setCachedConfig)

    expect(calls.remove).toHaveLength(0)
    expect(calls.set).toEqual([{ providerID: "myprovider", auth: { type: "api", key: "sk-test" } }])
  })

  // Regression tests for https://github.com/Kilo-Org/kilocode/issues/9186
  //
  // The CLI's config.update endpoint deep-merges its payload with the existing
  // global config. When the user removes a model or variant from a custom
  // provider and saves, the removed entry stays on disk because the save
  // payload only lists the surviving entries. stripNulls in the merge layer
  // will remove keys explicitly set to null — the save path must emit these
  // sentinels for removed model ids and variant names.
  it("emits null sentinels for models removed since last save", async () => {
    const existing = {
      disabled_providers: [],
      provider: {
        myprovider: {
          npm: "@ai-sdk/openai-compatible",
          name: "My Provider",
          options: { baseURL: "https://example.com/v1" },
          models: {
            "model-keep": { name: "Keep" },
            "model-gone": { name: "Gone" },
          },
        },
      },
    }
    const { ctx, calls, setCachedConfig } = createCtx(existing)

    const next = {
      name: "My Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-keep": { name: "Keep" },
      },
    }
    await saveCustomProvider(ctx, "req", "myprovider", next, undefined, false, null, setCachedConfig)

    expect(calls.config).toHaveLength(1)
    const payload = calls.config[0].config.provider as Record<string, { models: Record<string, unknown> }>
    expect(payload.myprovider.models["model-keep"]).toBeDefined()
    expect(payload.myprovider.models["model-gone"]).toBeNull()
  })

  it("emits null sentinels for variants removed from a model that still exists", async () => {
    const existing = {
      disabled_providers: [],
      provider: {
        myprovider: {
          npm: "@ai-sdk/openai-compatible",
          name: "My Provider",
          options: { baseURL: "https://example.com/v1" },
          models: {
            "model-1": {
              name: "Model One",
              reasoning: true,
              variants: {
                high: { reasoningEffort: "high" },
                low: { reasoningEffort: "low" },
              },
            },
          },
        },
      },
    }
    const { ctx, calls, setCachedConfig } = createCtx(existing)

    const next = {
      name: "My Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-1": {
          name: "Model One",
          reasoning: true,
          variants: { high: { reasoningEffort: "high" } },
        },
      },
    }
    await saveCustomProvider(ctx, "req", "myprovider", next, undefined, false, null, setCachedConfig)

    expect(calls.config).toHaveLength(1)
    const model = (
      calls.config[0].config.provider as Record<
        string,
        { models: Record<string, { variants?: Record<string, unknown> }> }
      >
    ).myprovider.models["model-1"]
    expect(model.variants).toBeDefined()
    expect(model.variants?.high).toBeDefined()
    expect(model.variants?.low).toBeNull()
  })

  it("does not emit sentinels when the provider is new", async () => {
    const { ctx, calls, setCachedConfig } = createCtx()

    await saveCustomProvider(ctx, "req", "myprovider", createProvider(), undefined, false, null, setCachedConfig)

    expect(calls.config).toHaveLength(1)
    const models = (calls.config[0].config.provider as Record<string, { models: Record<string, unknown> }>).myprovider
      .models
    expect(Object.values(models).every((v) => v !== null)).toBe(true)
  })
})

describe("fetchProviderData", () => {
  it("derives api auth state and strips keys from provider payloads", async () => {
    const client = {
      provider: {
        list: async () => ({
          data: {
            all: [
              {
                id: "groq-test",
                name: "Groq Test",
                source: "config",
                key: "sk-test",
                env: [],
                models: {},
              },
            ],
            connected: ["groq-test"],
            default: { "groq-test": "llama-3.1-8b-instant" },
          },
        }),
        auth: async () => ({ data: {} }),
      },
    } as unknown as Parameters<typeof fetchProviderData>[0]

    const result = await fetchProviderData(client, "/tmp")
    const item = result.response.all[0] as Record<string, unknown>

    expect(result.authStates).toEqual({ "groq-test": "api" })
    expect("key" in item).toBe(false)
  })
})
