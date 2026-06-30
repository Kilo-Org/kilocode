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
  test("builds a deterministic allowlisted catalog with exact model identities", () => {
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
          id: "anthropic",
          name: "Anthropic",
          source: "env",
          env: [],
          options: {},
          models: {
            "claude-sonnet": sanitizedModel("anthropic", "claude-sonnet", "Claude Sonnet"),
          },
        },
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
      ],
      default: {
        anthropic: "claude-sonnet",
        "custom:edge": "model.with/slash-and:colon",
      },
      connected: ["anthropic", "custom:edge"],
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
      truncated: false,
    })
    expect(JSON.stringify(catalog)).not.toContain("must-not-leak")
    expect(JSON.stringify(catalog)).not.toContain("PRIVATE_API_KEY")
    expect(JSON.stringify(catalog)).not.toContain("private.example.com")
    expect(RemoteModelCatalog.Response.safeParse(catalog).success).toBe(true)
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

  test("omits overlong identities and display names without rewriting accepted values", () => {
    const overlong = "x".repeat(RemoteModelCatalog.MAX_IDENTITY_LENGTH + 1)
    const kept = model("custom", "kept/model", overlong)
    kept.variants = {
      exact: {},
      [overlong]: {},
    }

    const catalog = RemoteModelCatalog.build({
      providers: {
        custom: {
          id: "custom",
          name: overlong,
          models: {
            kept,
            removed: model("custom", overlong, "Removed"),
          },
        },
      },
      session: {},
      messages: [],
    })

    expect(catalog.all).toHaveLength(1)
    expect(catalog.all[0]?.name).toBe("custom")
    expect(Object.keys(catalog.all[0]?.models ?? {})).toEqual(["kept/model"])
    expect(catalog.all[0]?.models["kept/model"]?.name).toBe("kept/model")
    expect(catalog.all[0]?.models["kept/model"]?.variants).toEqual({ exact: {} })
    expect(catalog.default).toEqual({ custom: "kept/model" })
    expect(catalog.connected).toEqual(["custom"])
    expect(catalog.truncated).toBe(true)
  })

  test("never advertises an inherited property as a truncated provider default", () => {
    const models = Object.fromEntries([
      ...Array.from({ length: RemoteModelCatalog.MAX_MODELS_PER_PROVIDER }, (_, index) => {
        const id = `model-${index.toString().padStart(3, "0")}`
        return [id, model("provider", id, id)]
      }),
      ["toString", model("provider", "toString", "zzzz")],
    ])

    const catalog = RemoteModelCatalog.build({
      providers: {
        provider: { id: "provider", name: "Provider", models },
      },
      session: {},
      messages: [],
    })

    expect(Object.hasOwn(catalog.all[0]?.models ?? {}, "toString")).toBe(false)
    expect(catalog.default).toEqual({})
  })

  test("enforces provider, model, and variant count limits", () => {
    function models(count: number) {
      return Object.fromEntries(
        Array.from({ length: count }, (_, index) => {
          const item = model("provider", `model-${index.toString().padStart(4, "0")}`, `Model ${index}`)
          item.variants = Object.fromEntries(
            Array.from({ length: RemoteModelCatalog.MAX_VARIANTS_PER_MODEL + 1 }, (_entry, variant) => [
              `variant-${variant.toString().padStart(2, "0")}`,
              {},
            ]),
          )
          return [item.id, item]
        }),
      )
    }

    const providerOverflow = Object.fromEntries(
      Array.from({ length: RemoteModelCatalog.MAX_PROVIDERS + 1 }, (_, index) => {
        const id = `provider-${index.toString().padStart(2, "0")}`
        return [id, { id, name: id, models: models(1) }]
      }),
    )
    const providerCatalog = RemoteModelCatalog.build({ providers: providerOverflow, session: {}, messages: [] })
    const providers = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => {
        const id = `provider-${index.toString().padStart(2, "0")}`
        return [
          id,
          {
            id,
            name: id,
            models: models(index === 0 ? RemoteModelCatalog.MAX_MODELS_PER_PROVIDER + 1 : 512),
          },
        ]
      }),
    )
    const catalog = RemoteModelCatalog.build({ providers, session: {}, messages: [] })
    const modelCount = catalog.all.reduce((total, provider) => total + Object.keys(provider.models).length, 0)
    const variantCount = catalog.all.reduce(
      (total, provider) =>
        total +
        Object.values(provider.models).reduce(
          (modelsTotal, item) => modelsTotal + Object.keys(item.variants ?? {}).length,
          0,
        ),
      0,
    )

    expect(providerCatalog.all).toHaveLength(RemoteModelCatalog.MAX_PROVIDERS)
    expect(providerCatalog.truncated).toBe(true)
    expect(Object.keys(catalog.all[0]?.models ?? {})).toHaveLength(RemoteModelCatalog.MAX_MODELS_PER_PROVIDER)
    expect(modelCount).toBeLessThanOrEqual(RemoteModelCatalog.MAX_MODELS_TOTAL)
    expect(variantCount).toBeLessThanOrEqual(RemoteModelCatalog.MAX_VARIANTS_TOTAL)
    expect(
      catalog.all.every((provider) =>
        Object.values(provider.models).every(
          (item) => Object.keys(item.variants ?? {}).length <= RemoteModelCatalog.MAX_VARIANTS_PER_MODEL,
        ),
      ),
    ).toBe(true)
    expect(catalog.truncated).toBe(true)
  })

  test("uses UTF-8 bytes rather than string length when truncating", () => {
    function build(nameCharacter: string) {
      const models = Object.fromEntries(
        Array.from({ length: 1_000 }, (_, index) => {
          const id = `model-${index.toString().padStart(4, "0")}`
          return [id, model("provider", id, nameCharacter.repeat(RemoteModelCatalog.MAX_IDENTITY_LENGTH))]
        }),
      )
      return RemoteModelCatalog.build({
        providers: { provider: { id: "provider", name: "Provider", models } },
        session: {},
        messages: [],
      })
    }

    const ascii = build("x")
    const unicode = build("é")
    const count = (catalog: RemoteModelCatalog.Response) => Object.keys(catalog.all[0]?.models ?? {}).length

    expect(Buffer.byteLength(JSON.stringify(ascii))).toBeLessThanOrEqual(RemoteModelCatalog.MAX_SERIALIZED_BYTES)
    expect(Buffer.byteLength(JSON.stringify(unicode))).toBeLessThanOrEqual(RemoteModelCatalog.MAX_SERIALIZED_BYTES)
    expect(count(unicode)).toBeLessThan(count(ascii))
    expect(unicode.truncated).toBe(true)
  })

  test("keeps the serialized result within the byte budget while preserving model references", () => {
    const models = Object.fromEntries(
      Array.from({ length: RemoteModelCatalog.MAX_MODELS_TOTAL }, (_, index) => {
        const id = `model-${index.toString().padStart(4, "0")}-${"m".repeat(220)}`
        const item = model("provider", id, `Model ${index} ${"n".repeat(220)}`)
        item.variants = Object.fromEntries(
          Array.from({ length: 8 }, (_entry, variant) => [`variant-${variant}-${"v".repeat(220)}`, {}]),
        )
        return [id, item]
      }),
    )
    const input = {
      providers: {
        provider: {
          id: "provider",
          name: "Provider",
          models,
        },
      },
      session: {
        model: {
          id: "current/model",
          providerID: "provider",
          variant: "precise",
        },
      },
      messages: [],
      defaultModel: {
        providerID: "provider",
        modelID: "default/model",
      },
    }

    const first = RemoteModelCatalog.build(input)
    const second = RemoteModelCatalog.build(input)

    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(RemoteModelCatalog.MAX_SERIALIZED_BYTES)
    expect(first.currentModel).toEqual({
      model: { providerID: "provider", modelID: "current/model" },
      variant: "precise",
    })
    expect(first.defaultModel).toEqual({ providerID: "provider", modelID: "default/model" })
    expect(Object.keys(first.all[0]?.models ?? {}).length).toBeGreaterThan(0)
    expect(first.truncated).toBe(true)
    expect(second).toEqual(first)
  })
})
