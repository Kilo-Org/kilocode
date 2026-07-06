import { describe, expect, test } from "bun:test"
import { RemoteModelCatalog } from "../../../src/kilo-sessions/remote-model-catalog"

function sanitizedModel(providerID: string, id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    providerID,
    api: { id, url: "", npm: "" },
    name,
    capabilities: {
      temperature: true,
      attachment: true,
      reasoning: false,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 200_000, output: 8_192 },
    status: "active" as const,
    variants: { fast: {}, precise: {} },
    options: {},
    headers: {},
    release_date: "",
    ...extra,
  }
}

function model(providerID: string, id: string, name: string) {
  const variants: Record<string, Record<string, unknown>> = {
    fast: { apiKey: "must-not-leak" },
    precise: { baseURL: "https://private.example.com" },
  }
  return {
    id,
    providerID,
    api: {
      id: "private-deployment-id",
      url: "https://private.example.com",
      npm: "file:///private/provider-package",
    },
    name,
    capabilities: {
      temperature: true,
      attachment: true,
      reasoning: false,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 1,
      output: 2,
      cache: { read: 3, write: 4 },
    },
    limit: {
      context: 200_000,
      output: 8_192,
    },
    status: "active" as const,
    variants,
    options: { apiKey: "must-not-leak" },
    headers: { authorization: "must-not-leak" },
    release_date: "2026-01-01",
  }
}

describe("RemoteModelCatalog", () => {
  test("transforms providers to an allowlisted catalog with exact model identities", () => {
    const privateModel = model("custom:edge", "model.with/slash-and:colon", "Model One")
    Object.assign(privateModel, {
      recommendedIndex: 3,
      isFree: true,
      mayTrainOnYourPrompts: false,
      hasUserByokAvailable: true,
    })
    Object.assign(privateModel.capabilities, { privateCapabilityConfig: "must-not-leak" })
    Object.assign(privateModel.limit, { privateLimitConfig: "must-not-leak" })
    const catalog = RemoteModelCatalog.build({
      providers: {
        custom: {
          id: "custom:edge",
          name: "Zeta Provider",
          source: "config" as const,
          key: "must-not-leak",
          env: ["PRIVATE_API_KEY"],
          options: { baseURL: "https://private.example.com" },
          models: {
            model: privateModel,
          },
        },
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          source: "env" as const,
          env: ["ANTHROPIC_API_KEY"],
          options: { apiKey: "must-not-leak" },
          models: {
            claude: model("anthropic", "claude-sonnet", "Claude Sonnet"),
          },
        },
      },
      session: {
        model: {
          id: "model.with/slash-and:colon",
          providerID: "custom:edge",
          variant: "default",
        },
      },
      messages: [
        {
          info: {
            role: "user",
            model: { providerID: "anthropic", modelID: "claude-sonnet" },
          },
        },
      ],
      defaultModel: {
        providerID: "anthropic",
        modelID: "claude-sonnet",
      },
    })

    expect(catalog).toEqual({
      protocolVersion: 1,
      all: [
        {
          id: "custom:edge",
          name: "Zeta Provider",
          source: "config",
          env: [],
          options: {},
          models: {
            "model.with/slash-and:colon": sanitizedModel("custom:edge", "model.with/slash-and:colon", "Model One", {
              recommendedIndex: 3,
              isFree: true,
              mayTrainOnYourPrompts: false,
              hasUserByokAvailable: true,
            }),
          },
        },
        {
          id: "anthropic",
          name: "Anthropic",
          source: "env",
          env: [],
          options: {},
          models: {
            "claude-sonnet": sanitizedModel("anthropic", "claude-sonnet", "Claude Sonnet"),
          },
        },
      ],
      default: {
        "custom:edge": "model.with/slash-and:colon",
        anthropic: "claude-sonnet",
      },
      connected: ["custom:edge", "anthropic"],
      failed: [],
      truncated: false,
      currentModel: {
        model: {
          providerID: "custom:edge",
          modelID: "model.with/slash-and:colon",
        },
      },
      defaultModel: {
        providerID: "anthropic",
        modelID: "claude-sonnet",
      },
    })
    expect(JSON.stringify(catalog)).not.toContain("must-not-leak")
    expect(JSON.stringify(catalog)).not.toContain("PRIVATE_API_KEY")
    expect(JSON.stringify(catalog)).not.toContain("private.example.com")
  })

  test("keeps duplicate model IDs distinct across providers", () => {
    const catalog = RemoteModelCatalog.build({
      providers: {
        first: { id: "first", name: "First", models: { shared: model("first", "shared/model", "Shared") } },
        second: { id: "second", name: "Second", models: { shared: model("second", "shared/model", "Shared") } },
      },
      session: {},
      messages: [],
    })

    expect(catalog.all.map((provider) => [provider.id, Object.values(provider.models)[0]?.id])).toEqual([
      ["first", "shared/model"],
      ["second", "shared/model"],
    ])
  })

  test("uses the latest user message when the session has no current model", () => {
    const catalog = RemoteModelCatalog.build({
      providers: {
        latest: { id: "latest", name: "Latest", models: { "latest/model": model("latest", "latest/model", "Latest") } },
      },
      session: {},
      messages: [
        {
          info: {
            role: "user",
            model: { providerID: "older", modelID: "older/model", variant: "slow" },
          },
        },
        { info: { role: "assistant" } },
        {
          info: {
            role: "user",
            model: { providerID: "latest", modelID: "latest/model", variant: "default" },
          },
        },
        { info: { role: "user" } },
      ],
    })

    expect(catalog.currentModel).toEqual({
      model: { providerID: "latest", modelID: "latest/model" },
    })
  })

  test("drops empty identities and truncates overlong names", () => {
    const empty = ""
    const overlong = "x".repeat(500)
    const kept = model("custom", "kept/model", overlong)
    kept.variants = {
      exact: {},
      [empty]: {},
    }

    const catalog = RemoteModelCatalog.build({
      providers: {
        custom: {
          id: "custom",
          name: overlong,
          models: {
            kept,
            removed: model("custom", empty, "Removed"),
          },
        },
      },
      session: {},
      messages: [],
    })

    expect(catalog.all).toHaveLength(1)
    expect(catalog.all[0]?.name).toBe(overlong.slice(0, RemoteModelCatalog.MAX_NAME_LENGTH))
    expect(Object.keys(catalog.all[0]?.models ?? {})).toEqual(["kept/model"])
    expect(catalog.all[0]?.models["kept/model"]?.name).toBe(overlong.slice(0, RemoteModelCatalog.MAX_NAME_LENGTH))
    expect(catalog.all[0]?.models["kept/model"]?.variants).toEqual({ exact: {} })
    expect(catalog.default).toEqual({ custom: "kept/model" })
    expect(catalog.connected).toEqual(["custom"])
  })

  test("caps the total number of models and reports truncation", () => {
    const providers = Object.fromEntries(
      Array.from({ length: 3 }, (_, providerIndex) => {
        const id = `provider-${providerIndex}`
        return [
          id,
          {
            id,
            name: id,
            models: Object.fromEntries(
              Array.from({ length: RemoteModelCatalog.MAX_MODELS + 10 }, (_, modelIndex) => {
                const modelId = `model-${providerIndex}-${modelIndex}`
                return [modelId, model(id, modelId, modelId)]
              }),
            ),
          },
        ]
      }),
    )
    const catalog = RemoteModelCatalog.build({ providers, session: {}, messages: [] })
    const modelCount = catalog.all.reduce((total, provider) => total + Object.keys(provider.models).length, 0)

    expect(modelCount).toBe(RemoteModelCatalog.MAX_MODELS)
    expect(catalog.truncated).toBe(true)
  })

  test("truncation keeps the provider's preferred default model", () => {
    const providers = {
      big: {
        id: "big",
        name: "Big",
        models: Object.fromEntries([
          ...Array.from({ length: RemoteModelCatalog.MAX_MODELS }, (_, i) => {
            const id = `model-${i}`
            return [id, model("big", id, `Model ${i}`)]
          }),
          ["gpt-5-preferred", model("big", "gpt-5-preferred", "Preferred")],
        ]),
      },
    }
    const catalog = RemoteModelCatalog.build({ providers, session: {}, messages: [] })

    expect(catalog.truncated).toBe(true)
    expect(catalog.default).toEqual({ big: "gpt-5-preferred" })
    expect(Object.keys(catalog.all[0]?.models ?? {})).toContain("gpt-5-preferred")
  })

  test("omits currentModel and defaultModel when truncation drops them", () => {
    const providers = {
      big: {
        id: "big",
        name: "Big",
        models: Object.fromEntries([
          ...Array.from({ length: RemoteModelCatalog.MAX_MODELS }, (_, i) => {
            const id = `kept-${i}`
            return [id, model("big", id, `Kept ${i}`)]
          }),
          ["dropped-model", model("big", "dropped-model", "Dropped")],
        ]),
      },
    }
    const catalog = RemoteModelCatalog.build({
      providers,
      session: { model: { id: "dropped-model", providerID: "big", variant: "default" } },
      messages: [],
      defaultModel: { providerID: "big", modelID: "dropped-model" },
    })

    expect(catalog.truncated).toBe(true)
    expect(Object.keys(catalog.all[0]?.models ?? {})).not.toContain("dropped-model")
    expect(catalog.currentModel).toBeUndefined()
    expect(catalog.defaultModel).toBeUndefined()
  })

  test("caps overlong model names and variant maps", () => {
    const longName = "x".repeat(500)
    const manyVariants: Record<string, Record<string, unknown>> = {}
    for (let i = 0; i < 50; i++) {
      manyVariants[`variant-${i}`] = { secret: i }
    }
    manyVariants["y".repeat(100)] = { secret: "key" }

    const kept = model("custom", "kept/model", longName)
    kept.variants = manyVariants

    const catalog = RemoteModelCatalog.build({
      providers: {
        custom: {
          id: "custom",
          name: longName,
          models: { kept },
        },
      },
      session: {},
      messages: [],
    })

    expect(catalog.all[0]?.name.length).toBeLessThanOrEqual(RemoteModelCatalog.MAX_NAME_LENGTH)
    expect(catalog.all[0]?.models["kept/model"]?.name.length).toBeLessThanOrEqual(RemoteModelCatalog.MAX_NAME_LENGTH)
    const variants = catalog.all[0]?.models["kept/model"]?.variants
    expect(Object.keys(variants ?? {}).length).toBeLessThanOrEqual(RemoteModelCatalog.MAX_VARIANTS)
    expect(Object.keys(variants ?? {}).every((key) => key.length <= RemoteModelCatalog.MAX_VARIANT_KEY_LENGTH)).toBe(
      true,
    )
  })
})
