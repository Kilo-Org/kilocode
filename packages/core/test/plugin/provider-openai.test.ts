import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential" // kilocode_change
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OpenAIPlugin } from "@opencode-ai/core/plugin/provider/openai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  const integrations = yield* Integration.Service
  yield* OpenAIPlugin.effect(host).pipe(Effect.provideService(Integration.Service, integrations))
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

// kilocode_change start - stub the ChatGPT token endpoint for the refresh tests
function stubTokenFetch(body: Record<string, unknown>) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const original = globalThis.fetch
      const requests: Request[] = []
      const bodies: string[] = []
      globalThis.fetch = Object.assign(
        async (...args: Parameters<typeof globalThis.fetch>) => {
          const request = new Request(...args)
          requests.push(request)
          if (request.url === "https://auth.openai.com/oauth/token") {
            // Read the body inside the stub: Effect.tryPromise aborts the request signal once the
            // effect completes, and an aborted request can no longer be read afterwards.
            bodies.push(await request.text())
            return Response.json(body)
          }
          return new Response("", { status: 200 })
        },
        { preconnect: original.preconnect },
      )
      return { original, requests, bodies }
    }),
    (saved) =>
      Effect.sync(() => {
        globalThis.fetch = saved.original
      }),
  )
}
// kilocode_change end

function fakeSelectorSdk(calls: string[]) {
  const make = (method: string) => (id: string) => {
    calls.push(`${method}:${id}`)
    return { modelId: id, provider: method, specificationVersion: "v3" } as unknown as LanguageModelV3
  }
  return {
    responses: make("responses"),
    messages: make("messages"),
    chat: make("chat"),
    languageModel: make("languageModel"),
  }
}

describe("OpenAIPlugin", () => {
  it.effect("registers browser and headless ChatGPT OAuth methods", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      expect((yield* (yield* Integration.Service).get(Integration.ID.make("openai")))?.methods).toEqual([
        {
          id: Integration.MethodID.make("chatgpt-browser"),
          type: "oauth",
          label: "ChatGPT Pro/Plus (browser)",
        },
        {
          id: Integration.MethodID.make("chatgpt-headless"),
          type: "oauth",
          label: "ChatGPT Pro/Plus (headless)",
        },
      ])
    }),
  )

  it.effect("creates an OpenAI SDK for @ai-sdk/openai using the provider ID as SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-openai"), ModelV2.ID.make("gpt-5")),
          api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/openai",
        options: { name: "custom-openai", apiKey: "test" },
      })
      expect(result.sdk?.responses("gpt-5").provider).toBe("custom-openai.responses")
    }),
  )

  it.effect("ignores non-OpenAI SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5")),
          api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "openai" },
      })
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("uses the Responses API for language models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("alias")),
          api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "test-provider" },
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual(["responses:gpt-5"])
      expect(result.language).toBeDefined()
    }),
  )

  it.effect("ignores non-OpenAI providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.anthropic, ModelV2.ID.make("gpt-5")),
          api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "test-provider" },
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )

  it.effect("disables gpt-5-chat-latest during catalog transforms", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        const item = ProviderV2.Info.make({
          ...ProviderV2.Info.empty(ProviderV2.ID.openai),
          api: { type: "aisdk", package: "@ai-sdk/openai" },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
        })
        catalog.model.update(item.id, ModelV2.ID.make("gpt-5"), () => {})
        catalog.model.update(item.id, ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(required(yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5"))).enabled).toBe(true)
      expect(
        required(yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5-chat-latest"))).enabled,
      ).toBe(false)
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-OpenAI providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        const item = ProviderV2.Info.make({
          ...ProviderV2.Info.empty(ProviderV2.ID.make("custom-openai")),
          api: { type: "aisdk", package: "test-provider" },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
        })
        catalog.model.update(item.id, ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        required(yield* catalog.model.get(ProviderV2.ID.make("custom-openai"), ModelV2.ID.make("gpt-5-chat-latest")))
          .enabled,
      ).toBe(true)
    }),
  )

  // kilocode_change start - refresh keeps the stored secret unless the response supplies one
  it.live("refreshes the access token and keeps the stored refresh secret", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const { requests, bodies } = yield* stubTokenFetch({ id_token: "", access_token: "next-access", expires_in: 60 })
      const actual = yield* Effect.scoped(
        Effect.gen(function* () {
          const saved = yield* credentials.create({
            integrationID: Integration.ID.make("openai"),
            label: "Work",
            value: Credential.OAuth.make({
              type: "oauth",
              methodID: Integration.MethodID.make("chatgpt-browser"),
              access: "old-access",
              refresh: "old-refresh",
              expires: 1,
              metadata: { accountID: "acct-1" },
            }),
          })
          const resolved = yield* integrations.connection.resolve({ type: "credential", id: saved.id, label: "Work" })
          return { resolved, stored: (yield* credentials.get(saved.id))?.value }
        }),
      )
      expect(actual.resolved).toMatchObject({
        access: "next-access",
        refresh: "old-refresh",
        metadata: { accountID: "acct-1" },
      })
      expect(actual.stored).toMatchObject({
        access: "next-access",
        refresh: "old-refresh",
        metadata: { accountID: "acct-1" },
      })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe("https://auth.openai.com/oauth/token")
      expect(bodies[0]).toContain("grant_type=refresh_token")
      expect(bodies[0]).toContain("refresh_token=old-refresh")
    }),
  )

  it.live("stores a new refresh secret supplied by the response", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      yield* stubTokenFetch({
        id_token: "",
        access_token: "next-access",
        refresh_token: "next-refresh",
        expires_in: 60,
      })
      const stored = yield* Effect.scoped(
        Effect.gen(function* () {
          const saved = yield* credentials.create({
            integrationID: Integration.ID.make("openai"),
            label: "Work",
            value: Credential.OAuth.make({
              type: "oauth",
              methodID: Integration.MethodID.make("chatgpt-browser"),
              access: "old-access",
              refresh: "old-refresh",
              expires: 1,
              metadata: { accountID: "acct-1" },
            }),
          })
          yield* integrations.connection.resolve({ type: "credential", id: saved.id, label: "Work" })
          return (yield* credentials.get(saved.id))?.value
        }),
      )
      expect(stored).toMatchObject({ access: "next-access", refresh: "next-refresh" })
    }),
  )
  // kilocode_change end
})
