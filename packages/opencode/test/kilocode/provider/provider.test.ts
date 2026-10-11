import { afterEach, describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { Env } from "@/env"
import { Plugin } from "@/plugin/index"
import { Provider } from "@/provider/provider"
import { cheapestSmallModel, isLoopbackProvider } from "@/kilocode/provider/provider"
import { disposeAllInstances } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const originalEnv = new Map<string, string | undefined>()

const rememberEnv = (key: string) => {
  if (!originalEnv.has(key)) originalEnv.set(key, process.env[key])
}

const clearEnv = (key: string) =>
  Effect.gen(function* () {
    rememberEnv(key)
    delete process.env[key]
    yield* Env.use.remove(key)
  })

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnv.clear()
  await disposeAllInstances()
})

const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node])))

it.instance(
  "getSmallModel picks provider model when model IDs lack family metadata",
  Effect.gen(function* () {
    for (const key of ["KILO_API_KEY", "KILO_AUTH_CONTENT", "KILO_CONFIG_CONTENT"]) {
      yield* clearEnv(key)
    }
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toMatchObject({ providerID: "test-provider", id: "gpt-5-nano" })
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "gpt-5-nano": { release_date: "2026-01-01" },
          },
          options: { apiKey: "test-key" },
        },
        kilo: null,
      },
    },
  },
)

it.instance(
  "getSmallModel picks provider model over kilo auto",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toMatchObject({ providerID: "test-provider", id: "gpt-5-nano" })
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "gpt-5-nano": { release_date: "2026-01-01" },
          },
          options: { apiKey: "test-key" },
        },
        kilo: {
          options: { apiKey: "kilo-key" },
        },
      },
    },
  },
)

it.instance(
  "getSmallModel prefers family match over a cheaper unlisted model",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toMatchObject({ providerID: "test-provider", id: "new-flash" })
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "new-flash": { family: "gemini-flash", release_date: "2026-01-01", cost: { input: 3, output: 15 } },
            "cheap-thing": { release_date: "2026-06-01", cost: { input: 0, output: 0 } },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

// The #13192 contract: without kilo credentials the cloud fallback stays
// unreachable, so auxiliary tasks fall back to the session's own model
// (getSmallModel returning undefined).
it.instance(
  "getSmallModel returns undefined for loopback providers so callers keep the session model",
  Effect.gen(function* () {
    for (const key of ["KILO_API_KEY", "KILO_AUTH_CONTENT", "KILO_CONFIG_CONTENT"]) {
      yield* clearEnv(key)
    }
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("lmstudio"))
    expect(model).toBeUndefined()
  }),
  {
    config: {
      provider: {
        lmstudio: {
          name: "LM Studio",
          npm: "@ai-sdk/openai-compatible",
          models: {
            // Catalog lists every known model, but only installed ones are
            // served. The cheap pick must not name an uninstalled model.
            "openai/gpt-oss-20b": { release_date: "2026-01-01" },
            "qwen/qwen3-30b-a3b-2507": { release_date: "2026-02-01" },
          },
          options: { baseURL: "http://localhost:1234/v1" },
        },
        kilo: null,
      },
    },
  },
)
it.instance(
  "getSmallModel returns undefined without kilo credentials when the provider has no chat-capable model",
  Effect.gen(function* () {
    for (const key of ["KILO_API_KEY", "KILO_AUTH_CONTENT", "KILO_CONFIG_CONTENT"]) {
      yield* clearEnv(key)
    }
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toBeUndefined()
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "nomic-embed-text": { release_date: "2026-01-01", modalities: { input: ["text"], output: [] } },
          },
          options: { apiKey: "test-key" },
        },
        kilo: null,
      },
    },
  },
)

it.instance(
  "getSmallModel falls back to kilo-auto/small with kilo credentials when the provider has no chat-capable model",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toMatchObject({ providerID: "kilo", id: "kilo-auto/small" })
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "nomic-embed-text": { release_date: "2026-01-01", modalities: { input: ["text"], output: [] } },
          },
          options: { apiKey: "test-key" },
        },
        kilo: {
          options: { apiKey: "kilo-key" },
        },
      },
    },
  },
)

describe("cheapestSmallModel", () => {
  const model = (over: { id: string } & Record<string, unknown>): Provider.Model =>
    ({
      providerID: "test",
      name: over.id,
      family: "",
      capabilities: {
        toolcall: true,
        attachment: false,
        reasoning: false,
        temperature: true,
        input: { text: true, image: false, audio: false, video: false, pdf: false },
        output: { text: true, image: false, audio: false, video: false, pdf: false },
      },
      cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
      release_date: "2026-01-01",
      options: {},
      headers: {},
      ...over,
    }) as Provider.Model

  test("picks the cheapest text model", () => {
    const picked = cheapestSmallModel([
      model({ id: "premium", cost: { input: 3, output: 15, cache: { read: 0, write: 0 } } }),
      model({ id: "budget", cost: { input: 0.1, output: 0.2, cache: { read: 0, write: 0 } } }),
      model({ id: "mid", cost: { input: 0.5, output: 1, cache: { read: 0, write: 0 } } }),
    ])
    expect(picked).toMatchObject({ id: "budget" })
  })

  test("breaks cost ties by release date, then id", () => {
    const same = model({ id: "b", release_date: "2026-01-01" })
    const newer = model({ id: "a", release_date: "2026-06-01" })
    const sameAsNewer = model({ id: "z", release_date: "2026-06-01" })
    expect(cheapestSmallModel([same, newer])).toMatchObject({ id: "a" })
    expect(cheapestSmallModel([same, sameAsNewer])).toMatchObject({ id: "z" })
  })

  test("skips embedding and rerank models even when they are free", () => {
    const free = { input: 0, output: 0, cache: { read: 0, write: 0 } }
    const picked = cheapestSmallModel([
      model({ id: "nomic-embed-text", family: "nomic-embed", cost: free }),
      model({ id: "jina-reranker-v3", cost: free }),
      model({ id: "Qwen/Qwen3-Reranker-0.6B", cost: free }),
      model({ id: "intfloat/e5-mistral-7b-instruct", cost: free }),
      model({ id: "bge-m3", cost: free }),
      model({ id: "gpt-oss-120b", cost: { input: 0.15, output: 0.6, cache: { read: 0, write: 0 } } }),
    ])
    expect(picked).toMatchObject({ id: "gpt-oss-120b" })
  })

  test("keeps similarly-named chat models", () => {
    const picked = cheapestSmallModel([
      model({ id: "voyager-chat", cost: { input: 0.5, output: 0.5, cache: { read: 0, write: 0 } } }),
    ])
    expect(picked).toMatchObject({ id: "voyager-chat" })
  })

  test("keeps tool-less chat models like sonar", () => {
    const picked = cheapestSmallModel([
      model({
        id: "sonar",
        family: "sonar",
        capabilities: {
          toolcall: false,
          attachment: false,
          reasoning: false,
          temperature: true,
          input: { text: true, image: false, audio: false, video: false, pdf: false },
          output: { text: true, image: false, audio: false, video: false, pdf: false },
        },
        cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
      }),
    ])
    expect(picked).toMatchObject({ id: "sonar" })
  })

  test("skips models without text output", () => {
    const picked = cheapestSmallModel([
      model({
        id: "image-gen",
        capabilities: {
          toolcall: true,
          attachment: false,
          reasoning: false,
          temperature: true,
          input: { text: true, image: false, audio: false, video: false, pdf: false },
          output: { text: false, image: true, audio: false, video: false, pdf: false },
        },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      }),
      model({ id: "chat", cost: { input: 0.5, output: 0.5, cache: { read: 0, write: 0 } } }),
    ])
    expect(picked).toMatchObject({ id: "chat" })
  })

  test("skips safety and classification models even when they are free", () => {
    const free = { input: 0, output: 0, cache: { read: 0, write: 0 } }
    const picked = cheapestSmallModel([
      model({ id: "gpt-oss-safeguard-120b", cost: free }),
      model({ id: "qwen3guard-gen-8b", cost: free }),
      model({ id: "llama-guard-4-12b", cost: free }),
      model({ id: "chat", cost: { input: 0.5, output: 0.5, cache: { read: 0, write: 0 } } }),
    ])
    expect(picked).toMatchObject({ id: "chat" })
  })

  test("checks the api id so an alias cannot bypass the embedding exclusion", () => {
    const free = { input: 0, output: 0, cache: { read: 0, write: 0 } }
    const picked = cheapestSmallModel([
      model({ id: "vectors", api: { id: "nomic-embed-text" }, cost: free }),
      model({ id: "chat", api: { id: "chat" }, cost: { input: 0.5, output: 0.5, cache: { read: 0, write: 0 } } }),
    ])
    expect(picked).toMatchObject({ id: "chat" })
  })
})

describe("isLoopbackProvider", () => {
  test("loopback baseURL marks a local provider", () => {
    expect(isLoopbackProvider({ options: { baseURL: "http://localhost:1234/v1" }, models: {} })).toBe(true)
    expect(isLoopbackProvider({ options: { baseURL: "http://127.0.0.1:11434/v1" }, models: {} })).toBe(true)
  })

  test("remote baseURL is not local even for a local-sounding provider", () => {
    expect(isLoopbackProvider({ options: { baseURL: "https://api.openai.com/v1" }, models: {} })).toBe(false)
  })

  test("loopback model urls mark a local provider without a baseURL", () => {
    const url = "http://127.0.0.1:1234/v1"
    expect(isLoopbackProvider({ options: {}, models: { a: { api: { url } } as any } })).toBe(true)
    expect(isLoopbackProvider({ options: {}, models: {} })).toBe(false)
  })
})
