import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { ModelsDev } from "../../src/provider/models"
import { Provider } from "../../src/provider/provider"
import { TestConfig } from "../fixture/config"
import { testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(Provider.node))
const inference = testEffect(testInstanceStoreLayer)

const auth = <A, E, R>(value: Record<string, unknown>, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.KILO_AUTH_CONTENT
      process.env.KILO_AUTH_CONTENT = JSON.stringify(value)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.KILO_AUTH_CONTENT
        else process.env.KILO_AUTH_CONTENT = previous
      }),
  )

it.instance(
  "uses saved Azure resource metadata",
  () =>
    auth(
      { azure: { type: "api", key: "azure-key", metadata: { resourceName: "saved-resource" } } },
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const item = (yield* provider.list())[ProviderV2.ID.make("azure")]
        expect(item.key).toBe("azure-key")
        expect(item.options.resourceName).toBe("saved-resource")
      }),
    ),
  { config: {} },
)

it.instance(
  "uses saved GitLab OAuth access",
  () =>
    auth(
      { gitlab: { type: "oauth", refresh: "refresh", access: "oauth-access", expires: Date.now() + 60_000 } },
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const item = (yield* provider.list())[ProviderV2.ID.make("gitlab")]
        expect(item.options.apiKey).toBe("oauth-access")
      }),
    ),
  { config: {} },
)

it.instance(
  "uses saved Cloudflare Workers AI account metadata",
  () =>
    auth(
      {
        "cloudflare-workers-ai": {
          type: "api",
          key: "cloudflare-key",
          metadata: { accountId: "saved-account" },
        },
      },
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const item = (yield* provider.list())[ProviderV2.ID.make("cloudflare-workers-ai")]
        expect(item.key).toBe("cloudflare-key")
        expect(item.options.apiKey).toBe("cloudflare-key")
        const model = Object.values(item.models)[0]
        const language = yield* provider.getLanguage(model)
        const url = (
          language as unknown as { config: { url: (input: { path: string; modelId: string }) => string } }
        ).config.url({ path: "/chat/completions", modelId: model.id })
        expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/saved-account/ai/v1/chat/completions")
      }),
    ),
  { config: {} },
)

function environment(values: Record<string, string | undefined>) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key]
        if (value !== undefined) process.env[key] = value
      }
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          if (value !== undefined) process.env[key] = value
        }
      }),
  )
}

const oauth = {
  type: "oauth",
  refresh: "stored-refresh",
  access: "stored-token",
  accountId: "stored-org",
  expires: Date.now() + 3_600_000,
} satisfies Auth.Info
const configured = {
  apiKey: "configured-key",
  kilocodeToken: "configured-token",
  kilocodeOrganizationId: "configured-org",
}
const scenarios: {
  name: string
  info?: Auth.Info
  env?: string
  organization?: string
  options?: Record<string, string>
  key: string
  org?: string
  token?: string
}[] = [
  {
    name: "environment over OAuth and config",
    info: oauth,
    env: "env-token",
    organization: "env-org",
    options: configured,
    key: "env-token",
    org: "env-org",
    token: "env-token",
  },
  {
    name: "environment over saved API and config",
    info: { type: "api", key: "stored-key" },
    env: "env-token",
    organization: "env-org",
    options: configured,
    key: "env-token",
    org: "env-org",
    token: "env-token",
  },
  {
    name: "OAuth over config",
    info: oauth,
    options: configured,
    key: "stored-token",
    org: "stored-org",
    token: "stored-token",
  },
  {
    name: "saved API over config",
    info: { type: "api", key: "stored-key" },
    options: configured,
    key: "stored-key",
    org: "configured-org",
    token: "stored-key",
  },
  {
    name: "configured token alias over apiKey",
    options: configured,
    key: "configured-token",
    org: "configured-org",
    token: "configured-token",
  },
  {
    name: "configured apiKey",
    options: { apiKey: "configured-key", kilocodeOrganizationId: "configured-org" },
    key: "configured-key",
    org: "configured-org",
    token: "configured-key",
  },
  {
    name: "empty environment falls back to OAuth",
    info: oauth,
    env: "",
    organization: "",
    options: configured,
    key: "stored-token",
    org: "stored-org",
    token: "stored-token",
  },
  {
    name: "empty OAuth token overrides config",
    info: { ...oauth, access: "" },
    options: configured,
    key: "",
    org: "stored-org",
    token: "",
  },
  {
    name: "empty saved API token overrides config",
    info: { type: "api", key: "" },
    options: configured,
    key: "",
    org: "configured-org",
    token: "",
  },
  {
    name: "empty configured token overrides apiKey",
    options: { ...configured, kilocodeToken: "" },
    key: "",
    org: "configured-org",
    token: "",
  },
  { name: "empty configured apiKey remains empty", options: { apiKey: "" }, key: "" },
  {
    name: "empty OAuth Org falls back to config",
    info: { ...oauth, accountId: "" },
    options: configured,
    key: "stored-token",
    org: "configured-org",
    token: "stored-token",
  },
  {
    name: "environment token keeps OAuth Org",
    info: oauth,
    env: "env-token",
    options: configured,
    key: "env-token",
    org: "stored-org",
    token: "env-token",
  },
  {
    name: "environment Org keeps OAuth token",
    info: oauth,
    organization: "env-org",
    options: configured,
    key: "stored-token",
    org: "env-org",
    token: "stored-token",
  },
  {
    name: "configured URL Org fallback",
    options: { apiKey: "configured-key", baseURL: "https://gateway.test/api/organizations/url-org" },
    key: "configured-key",
    org: "url-org",
    token: "configured-key",
  },
  {
    name: "token URL Org fallback",
    options: { kilocodeToken: "https://gateway.test/api/organizations/token-org:configured-token" },
    key: "https://gateway.test/api/organizations/token-org:configured-token",
    org: "token-org",
    token: "https://gateway.test/api/organizations/token-org:configured-token",
  },
  {
    name: "environment without stored or configured credentials",
    env: "env-token",
    organization: "env-org",
    key: "env-token",
    org: "env-org",
    token: "env-token",
  },
  { name: "anonymous without credentials", key: "anonymous" },
  { name: "empty Org stays personal", options: { kilocodeOrganizationId: "" }, key: "anonymous", org: "" },
]

for (const scenario of scenarios) {
  inference.instance(`Kilo inference uses ${scenario.name}`, () =>
    Effect.gen(function* () {
      yield* environment({
        KILO_API_KEY: scenario.env,
        KILO_ORG_ID: scenario.organization,
        KILO_AUTH_CONTENT: JSON.stringify(scenario.info ? { kilo: scenario.info } : {}),
      })
      const calls: Headers[] = []
      const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(new Headers(init?.headers))
        return Response.json({ error: { message: "test inference response" } }, { status: 401 })
      }
      const config: Config.Info = {
        provider: {
          kilo: {
            npm: "@kilocode/kilo-gateway",
            env: ["KILO_API_KEY"],
            options: { ...scenario.options, headers: { "x-custom": "preserved" }, fetch },
            models: { "test-model": { name: "Test Model", limit: { context: 128000, output: 4096 } } },
          },
        },
      }
      yield* Effect.gen(function* () {
        const provider = yield* Provider.Service
        const item = yield* provider.getProvider(ProviderV2.ID.kilo)
        expect(item.options.kilocodeToken).toBe(scenario.token)
        expect(item.options.kilocodeOrganizationId).toBe(scenario.org)
        expect(item.options.fetch).toBe(fetch)
        expect(item.options.headers).toEqual({ "x-custom": "preserved" })
        const output = Provider.toPublicInfo(item)
        expect(output.key).toBeUndefined()
        expect(output.options.apiKey).toBeUndefined()
        expect(output.options.kilocodeToken).toBeUndefined()
        expect(output.options.headers).toEqual({ "x-custom": "preserved" })
        expect(item.options.kilocodeToken).toBe(scenario.token)
        const model = yield* provider.getModel(ProviderV2.ID.kilo, ModelV2.ID.make("test-model"))
        const language = yield* provider.getLanguage(model)
        const error = yield* Effect.tryPromise(() =>
          language.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }] }),
        ).pipe(Effect.flip)
        expect(error.cause).toMatchObject({ message: "test inference response" })
        expect(calls).toHaveLength(1)
        expect(calls.at(0)?.get("authorization")).toBe(`Bearer ${scenario.key}`.trim())
        expect(calls.at(0)?.get("x-kilocode-organizationid")).toBe(scenario.org || null)
        expect(calls.at(0)?.get("x-custom")).toBe("preserved")
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(Provider.node, [
            [Config.node, TestConfig.layer({ get: () => Effect.succeed(config) })],
            [ModelsDev.node, Layer.mock(ModelsDev.Service)({ get: () => Effect.succeed({}) })],
          ]),
        ),
      )
    }),
  )
}

inference.instance("non-Kilo inference keeps OAuth over environment and configured API keys", () =>
  Effect.gen(function* () {
    yield* environment({
      KILO_API_KEY: "kilo-env-token",
      KILO_ORG_ID: "kilo-env-org",
      OPENAI_API_KEY: "openai-env-token",
      KILO_AUTH_CONTENT: JSON.stringify({ openai: oauth }),
    })
    const calls: Headers[] = []
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const original = globalThis.fetch
        globalThis.fetch = Object.assign(
          async (_input: RequestInfo | URL, init?: RequestInit) => {
            calls.push(new Headers(init?.headers))
            return Response.json({ error: { message: "test inference response" } }, { status: 401 })
          },
          { preconnect: original.preconnect },
        )
        return original
      }),
      (original) =>
        Effect.sync(() => {
          globalThis.fetch = original
        }),
    )
    const config: Config.Info = {
      provider: {
        openai: {
          npm: "@ai-sdk/openai",
          env: ["OPENAI_API_KEY"],
          options: { apiKey: "configured-openai-key", headers: { "x-custom": "preserved" } },
          models: { "gpt-5": { name: "GPT-5", limit: { context: 128000, output: 4096 } } },
        },
      },
    }
    yield* Effect.gen(function* () {
      const provider = yield* Provider.Service
      const item = yield* provider.getProvider(ProviderV2.ID.openai)
      expect(item.key).toBeUndefined()
      expect(item.options.kilocodeToken).toBeUndefined()
      expect(item.options.kilocodeOrganizationId).toBeUndefined()
      expect(item.options.apiKey).toBe("configured-openai-key")
      expect(typeof item.options.fetch).toBe("function")
      expect(Provider.toPublicInfo(item).options.apiKey).toBe("configured-openai-key")
      const model = yield* provider.getModel(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5"))
      const language = yield* provider.getLanguage(model)
      const error = yield* Effect.tryPromise(() =>
        language.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }] }),
      ).pipe(Effect.flip)
      expect(error.cause).toMatchObject({ message: "test inference response" })
      expect(calls).toHaveLength(1)
      expect(calls.at(0)?.get("authorization")).toBe("Bearer stored-token")
      expect(calls.at(0)?.get("chatgpt-account-id")).toBe("stored-org")
      expect(calls.at(0)?.get("x-kilocode-organizationid")).toBeNull()
      expect(calls.at(0)?.get("x-custom")).toBe("preserved")
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(Provider.node, [
          [Config.node, TestConfig.layer({ get: () => Effect.succeed(config) })],
          [ModelsDev.node, Layer.mock(ModelsDev.Service)({ get: () => Effect.succeed({}) })],
        ]),
      ),
    )
  }),
)
