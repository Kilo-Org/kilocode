import { describe, expect, test } from "bun:test"
import { RemoteModelCatalog } from "../../../src/kilo-sessions/remote-model-catalog"

function sanitizedModel(providerID: string, id: string, name: string) {
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
            "model.with/slash-and:colon": sanitizedModel("custom:edge", "model.with/slash-and:colon", "Model One"),
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
      providers: {},
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

  test("drops empty identities but keeps overlong ones", () => {
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
    expect(catalog.all[0]?.name).toBe(overlong)
    expect(Object.keys(catalog.all[0]?.models ?? {})).toEqual(["kept/model"])
    expect(catalog.all[0]?.models["kept/model"]?.name).toBe(overlong)
    expect(catalog.all[0]?.models["kept/model"]?.variants).toEqual({ exact: {} })
    expect(catalog.default).toEqual({ custom: "kept/model" })
    expect(catalog.connected).toEqual(["custom"])
  })

  test("includes all valid providers and models", () => {
    const providers = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => {
        const id = `provider-${index.toString().padStart(2, "0")}`
        return [
          id,
          {
            id,
            name: id,
            models: Object.fromEntries(
              Array.from({ length: 10 }, (_, modelIndex) => {
                const modelId = `model-${modelIndex.toString().padStart(2, "0")}`
                return [modelId, model(id, `${id}/${modelId}`, modelId)]
              }),
            ),
          },
        ]
      }),
    )
    const catalog = RemoteModelCatalog.build({ providers, session: {}, messages: [] })
    const modelCount = catalog.all.reduce((total, provider) => total + Object.keys(provider.models).length, 0)

    expect(catalog.all).toHaveLength(5)
    expect(modelCount).toBe(50)
  })
})
