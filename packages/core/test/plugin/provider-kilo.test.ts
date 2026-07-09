import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { KiloPlugin } from "@opencode-ai/core/plugin/provider/kilo"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { expectPluginRegistered, it, model, provider, withEnv } from "./provider-helper" // kilocode_change

describe("KiloPlugin", () => {
  it.effect("is registered so legacy referer headers can be applied", () =>
    Effect.sync(() =>
      expectPluginRegistered(
        ProviderPlugins.map((item) => item.id),
        "kilo",
      ),
    ),
  )

  it.effect("applies legacy referer headers only to kilo", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(KiloPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const kilo = provider("kilo", {
          endpoint: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.kilo.ai/api/gateway" },
          options: { headers: { Existing: "value" }, body: {}, aisdk: { provider: {}, request: {} } },
        })
        catalog.provider.update(kilo.id, (draft) => {
          draft.endpoint = kilo.endpoint
          draft.options = kilo.options
        })
        catalog.provider.update(provider("openrouter").id, () => {})
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("kilo"))).options.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://kilo.ai/",
        "X-Title": "Kilo Code", // kilocode_change
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.openrouter)).options.headers).toEqual({})
    }),
  )

  it.effect("uses the exact legacy Kilo header casing and set", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(KiloPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("kilo", {
          endpoint: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.kilo.ai/api/gateway" },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.endpoint = item.endpoint
        })
      })

      const result = yield* catalog.provider.get(ProviderV2.ID.make("kilo"))
      expect(result.options.headers).toEqual({
        "HTTP-Referer": "https://kilo.ai/",
        "X-Title": "Kilo Code", // kilocode_change
      })
      expect(result.options.headers).not.toHaveProperty("http-referer")
      expect(result.options.headers).not.toHaveProperty("x-title")
      expect(result.options.headers).not.toHaveProperty("X-Source")
    }),
  )

  it.effect("uses the legacy provider-id guard instead of endpoint package matching", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(KiloPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const kilo = provider("kilo", {
          endpoint: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.kilo.ai/api/gateway" },
        })
        catalog.provider.update(kilo.id, (draft) => {
          draft.endpoint = kilo.endpoint
        })
        const custom = provider("custom-kilo", {
          endpoint: { type: "aisdk", package: "kilo" },
        })
        catalog.provider.update(custom.id, (draft) => {
          draft.endpoint = custom.endpoint
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.make("kilo"))).options.headers).toEqual({
        "HTTP-Referer": "https://kilo.ai/",
        "X-Title": "Kilo Code", // kilocode_change
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("custom-kilo"))).options.headers).toEqual({})
    }),
  )

  // kilocode_change start
  it.effect("routes the Kilo catalog through the Kilo Gateway SDK", () =>
    withEnv({ KILO_API_KEY: undefined, KILO_ORG_ID: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(KiloPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("kilo", {
            endpoint: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.kilo.ai/api/gateway" },
            options: {
              headers: {},
              body: {},
              aisdk: { provider: { apiKey: "stored-token" }, request: {} },
            },
          })
          catalog.provider.update(item.id, (draft) => {
            draft.endpoint = item.endpoint
            draft.options = item.options
          })
        })
        const updated = yield* catalog.provider.get(ProviderV2.ID.make("kilo"))

        expect(updated.endpoint).toEqual({
          type: "aisdk",
          package: "@kilocode/kilo-gateway",
          url: "https://api.kilo.ai/api/openrouter",
        })
        expect(updated.options.aisdk.provider.kilocodeToken).toBe("stored-token")

        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("kilo", "kilo-auto/free"),
            package: "@kilocode/kilo-gateway",
            options: updated.options.aisdk.provider,
          },
          {},
        )
        expect(result.sdk).toBeDefined()
        expect(typeof result.sdk.languageModel).toBe("function")
        expect(typeof result.sdk.anthropic).toBe("function")
      }),
    ),
  )

  it.effect("keeps authenticated credentials ahead of inherited environment keys", () =>
    withEnv({ KILO_API_KEY: "environment-token", KILO_ORG_ID: "environment-org" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(KiloPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("kilo", {
            enabled: { via: "account", service: "kilo" },
            options: {
              headers: {},
              body: {},
              aisdk: {
                provider: { apiKey: "authenticated-token", kilocodeOrganizationId: "authenticated-org" },
                request: {},
              },
            },
          })
          catalog.provider.update(item.id, (draft) => {
            draft.enabled = item.enabled
            draft.options = item.options
          })
        })
        const result = yield* catalog.provider.get(ProviderV2.ID.make("kilo"))

        expect(result.enabled).toEqual({ via: "account", service: "kilo" })
        expect(result.options.aisdk.provider.kilocodeToken).toBe("authenticated-token")
        expect(result.options.aisdk.provider.kilocodeOrganizationId).toBe("environment-org")
      }),
    ),
  )

  it.effect("keeps anonymous Kilo models available without credentials", () =>
    withEnv({ KILO_API_KEY: undefined, KILO_ORG_ID: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(KiloPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => catalog.provider.update(ProviderV2.ID.make("kilo"), () => {}))
        const result = yield* catalog.provider.get(ProviderV2.ID.make("kilo"))

        expect(result.enabled).toEqual({ via: "custom", data: { anonymous: true } })
        expect(result.options.aisdk.provider.kilocodeToken).toBe("anonymous")
      }),
    ),
  )
  // kilocode_change end
})
