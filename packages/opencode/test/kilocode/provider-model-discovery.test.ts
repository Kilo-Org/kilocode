import { afterEach, expect, mock } from "bun:test"
import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Provider } from "../../src/provider/provider"
import { testEffect } from "../lib/effect"

const it = testEffect(Provider.defaultLayer)
const list = Provider.use.list()
const original = globalThis.fetch

type Handler = (url: string) => Response | Promise<Response | undefined> | undefined

function install(handler: Handler) {
  globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input)
    const response = await handler(url)
    if (response) return response
    return original(input as RequestInfo | URL, init)
  }) as unknown as typeof globalThis.fetch
}

function provider(discover?: boolean, npm: string | undefined = "@ai-sdk/openai-compatible") {
  return {
    name: "Custom OpenAI",
    api: "https://custom.openai.com/v1",
    ...(npm ? { npm } : {}),
    ...(discover === undefined ? {} : { discoverModels: discover }),
    env: [],
    models: { "gpt-4.1": { name: "Configured GPT-4.1" } },
    options: { apiKey: "test-key" },
  }
}

afterEach(() => {
  globalThis.fetch = original
})

it.instance(
  "discovers models for an enabled OpenAI-compatible provider",
  Effect.gen(function* () {
    let calls = 0
    install((url) => {
      if (url !== "https://custom.openai.com/v1/models") return
      calls += 1
      return Response.json({ data: [{ id: "gpt-4.1" }, { id: "gpt-4o" }] })
    })

    const providers = yield* list
    const models = providers[ProviderV2.ID.make("custom-openai")].models
    expect(calls).toBe(1)
    expect(models["gpt-4.1"]).toBeDefined()
    expect(models["gpt-4o"].api.url).toBe("https://custom.openai.com/v1")
    expect(models["gpt-4o"].api.npm).toBe("@ai-sdk/openai-compatible")
  }),
  { config: { provider: { "custom-openai": provider(true) } } },
)

it.instance(
  "defaults discovered models to the OpenAI-compatible SDK when npm is omitted",
  Effect.gen(function* () {
    install((url) => {
      if (url !== "https://custom.openai.com/v1/models") return
      return Response.json({ data: [{ id: "gpt-4o" }] })
    })

    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-openai")].models["gpt-4o"]
    expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
  }),
  { config: { provider: { "custom-openai": provider(true, undefined) } } },
)

for (const discover of [undefined, false] as const) {
  it.instance(
    `does not discover models when discovery is ${discover === undefined ? "omitted" : "disabled"}`,
    Effect.gen(function* () {
      let calls = 0
      install((url) => {
        if (url !== "https://custom.openai.com/v1/models") return
        calls += 1
        return Response.json({ data: [{ id: "gpt-4o" }] })
      })

      const providers = yield* list
      expect(providers[ProviderV2.ID.make("custom-openai")]).toBeDefined()
      expect(calls).toBe(0)
    }),
    { config: { provider: { "custom-openai": provider(discover) } } },
  )
}

it.instance(
  "discovers models concurrently across providers",
  Effect.gen(function* () {
    let second = false
    install(async (url) => {
      if (url === "https://first.custom.openai.com/v1/models") {
        await Promise.resolve()
        expect(second).toBe(true)
        return Response.json({ data: [{ id: "first-model" }] })
      }
      if (url === "https://second.custom.openai.com/v1/models") {
        second = true
        return Response.json({ data: [{ id: "second-model" }] })
      }
    })

    const providers = yield* list
    expect(providers[ProviderV2.ID.make("first-openai")].models["first-model"]).toBeDefined()
    expect(providers[ProviderV2.ID.make("second-openai")].models["second-model"]).toBeDefined()
  }),
  {
    config: {
      provider: {
        "first-openai": {
          name: "First OpenAI",
          api: "https://first.custom.openai.com/v1",
          discoverModels: true,
          env: [],
          models: {},
          options: { apiKey: "test-key" },
        },
        "second-openai": {
          name: "Second OpenAI",
          api: "https://second.custom.openai.com/v1",
          discoverModels: true,
          env: [],
          models: {},
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "keeps configured models when discovery returns duplicate ids",
  Effect.gen(function* () {
    install((url) => {
      if (url !== "https://custom.openai.com/v1/models") return
      return Response.json({ data: [{ id: "gpt-4.1" }, { id: "gpt-4o" }] })
    })

    const providers = yield* list
    const models = providers[ProviderV2.ID.make("custom-openai")].models
    expect(models["gpt-4.1"].name).toBe("Configured GPT-4.1")
    expect(models["gpt-4o"]).toBeDefined()
  }),
  { config: { provider: { "custom-openai": provider(true) } } },
)

it.instance(
  "keeps configured models when discovery fails",
  Effect.gen(function* () {
    install((url) => {
      if (url !== "https://custom.openai.com/v1/models") return
      return new Response("nope", { status: 500 })
    })

    const providers = yield* list
    const models = providers[ProviderV2.ID.make("custom-openai")].models
    expect(models["gpt-4.1"]).toBeDefined()
    expect(models["gpt-4o"]).toBeUndefined()
  }),
  { config: { provider: { "custom-openai": provider(true) } } },
)
