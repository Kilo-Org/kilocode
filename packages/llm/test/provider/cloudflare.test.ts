import { describe, expect } from "bun:test"
import { Config, ConfigProvider, Effect, Schema } from "effect" // kilocode_change
import { HttpClientRequest } from "effect/unstable/http"
import { LLM } from "../../src"
import { CloudflareAIGateway, CloudflareWorkersAI } from "../../src/providers/cloudflare"
import { Auth, LLMClient } from "../../src/route" // kilocode_change
import type { Model } from "../../src/schema" // kilocode_change
import { it } from "../lib/effect"
import { dynamicResponse } from "../lib/http"
import { sseEvents } from "../lib/sse"

const Json = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(Json)
const withEnv = (env: Record<string, string>) => Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))

// kilocode_change start
const gateway = (options: Parameters<typeof CloudflareAIGateway.configure>[0]) =>
  CloudflareAIGateway.configure({ accountId: "test-account", ...options }).model("openai/gpt-4o-mini")

const authHeaders = (headers: Record<string, string>) =>
  Object.fromEntries(
    ["cf-aig-authorization", "authorization", "x-explicit"].flatMap((name) =>
      headers[name] === undefined ? [] : [[name, headers[name]]],
    ),
  )

const gatewayRequest = (model: Model, env: Record<string, string>) =>
  Effect.gen(function* () {
    let captured: Record<string, string> | undefined
    const result = yield* LLM.generate(LLM.request({ model, prompt: "Say hello." })).pipe(
      withEnv(env),
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            captured = authHeaders(Object.fromEntries(web.headers))
            return input.respond(sseEvents(deltaChunk({ role: "assistant", content: "Hello" }), deltaChunk({}, "stop")), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
      Effect.match({
        onFailure: (error) => ({ ok: false as const, reason: error.reason._tag }),
        onSuccess: () => ({ ok: true as const, reason: undefined }),
      }),
    )
    return { ...result, headers: captured }
  })
// kilocode_change end

const deltaChunk = (delta: object, finishReason: string | null = null) => ({
  id: "chatcmpl_fixture",
  choices: [{ delta, finish_reason: finishReason }],
  usage: null,
})

describe("Cloudflare", () => {
  it.effect("prepares AI Gateway models through the OpenAI-compatible Chat protocol", () =>
    Effect.gen(function* () {
      const model = CloudflareAIGateway.configure({
        accountId: "test-account",
        gatewayId: "test-gateway",
        apiKey: "test-token",
      }).model("workers-ai/@cf/meta/llama-3.3-70b-instruct")

      expect(model).toMatchObject({
        id: "workers-ai/@cf/meta/llama-3.3-70b-instruct",
        provider: "cloudflare-ai-gateway",
        route: { id: "cloudflare-ai-gateway" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/compat")

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("cloudflare-ai-gateway")
      expect(prepared.body).toMatchObject({
        model: "workers-ai/@cf/meta/llama-3.3-70b-instruct",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("posts to the derived gateway endpoint with bearer auth", () =>
    Effect.gen(function* () {
      const response = yield* LLM.generate(
        LLM.request({
          model: CloudflareAIGateway.configure({
            accountId: "test-account",
            gatewayId: "test-gateway",
            apiKey: "test-token",
          }).model("openai/gpt-4o-mini"),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe(
                "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/compat/chat/completions",
              )
              expect(web.headers.get("authorization")).toBe("Bearer test-token")
              expect(decodeJson(input.text)).toMatchObject({
                model: "openai/gpt-4o-mini",
                stream: true,
                messages: [{ role: "user", content: "Say hello." }],
              })
              return input.respond(
                sseEvents(deltaChunk({ role: "assistant", content: "Hello" }), deltaChunk({}, "stop")),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("Hello")
    }),
  )

  it.effect("defaults AI Gateway id to default when omitted or blank", () =>
    Effect.gen(function* () {
      expect(
        CloudflareAIGateway.configure({
          accountId: "test-account",
          gatewayId: "",
          gatewayApiKey: "test-token",
        }).model("workers-ai/@cf/meta/llama-3.3-70b-instruct").route.endpoint.baseURL,
      ).toBe("https://gateway.ai.cloudflare.com/v1/test-account/default/compat")
    }),
  )

  it.effect("supports authenticated AI Gateway plus upstream provider auth", () =>
    Effect.gen(function* () {
      yield* LLM.generate(
        LLM.request({
          model: CloudflareAIGateway.configure({
            accountId: "test-account",
            gatewayApiKey: "gateway-token",
            apiKey: "provider-token",
          }).model("openai/gpt-4o-mini"),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe("https://gateway.ai.cloudflare.com/v1/test-account/default/compat/chat/completions")
              expect(web.headers.get("cf-aig-authorization")).toBe("Bearer gateway-token")
              expect(web.headers.get("authorization")).toBe("Bearer provider-token")
              return input.respond(
                sseEvents(deltaChunk({ role: "assistant", content: "Hello" }), deltaChunk({}, "stop")),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )
    }),
  )

  // kilocode_change start
  it.effect("attaches the gateway header and the provider bearer for every credential combination", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        name: string
        model: Model
        env: Record<string, string>
        headers: Record<string, string>
      }> = [
        {
          name: "gateway environment token with a provider key",
          model: gateway({ accountId: "test-account", apiKey: "provider-token" }),
          env: { CLOUDFLARE_API_TOKEN: "gateway-token" },
          headers: { "cf-aig-authorization": "Bearer gateway-token", authorization: "Bearer provider-token" },
        },
        {
          name: "alternate gateway environment token with a provider key",
          model: gateway({ accountId: "test-account", apiKey: "provider-token" }),
          env: { CF_AIG_TOKEN: "gateway-token" },
          headers: { "cf-aig-authorization": "Bearer gateway-token", authorization: "Bearer provider-token" },
        },
        {
          name: "gateway key with a provider key",
          model: gateway({ accountId: "test-account", gatewayApiKey: "gateway-token", apiKey: "provider-token" }),
          env: {},
          headers: { "cf-aig-authorization": "Bearer gateway-token", authorization: "Bearer provider-token" },
        },
        {
          name: "gateway key alone",
          model: gateway({ accountId: "test-account", gatewayApiKey: "gateway-token" }),
          env: {},
          headers: { "cf-aig-authorization": "Bearer gateway-token" },
        },
        {
          name: "gateway environment token alone",
          model: gateway({ accountId: "test-account" }),
          env: { CLOUDFLARE_API_TOKEN: "gateway-token" },
          headers: { "cf-aig-authorization": "Bearer gateway-token" },
        },
        {
          name: "provider key alone",
          model: gateway({ accountId: "test-account", apiKey: "provider-token" }),
          env: {},
          headers: { authorization: "Bearer provider-token" },
        },
        {
          name: "empty gateway key with no gateway credential",
          model: gateway({ accountId: "test-account", gatewayApiKey: "", apiKey: "provider-token" }),
          env: {},
          headers: { authorization: "Bearer provider-token" },
        },
        {
          name: "gateway key takes precedence over a gateway environment token",
          model: gateway({ accountId: "test-account", gatewayApiKey: "option-token", apiKey: "provider-token" }),
          env: { CLOUDFLARE_API_TOKEN: "environment-token" },
          headers: { "cf-aig-authorization": "Bearer option-token", authorization: "Bearer provider-token" },
        },
        {
          name: "empty gateway key with a gateway environment token",
          model: gateway({ accountId: "test-account", gatewayApiKey: "", apiKey: "provider-token" }),
          env: { CLOUDFLARE_API_TOKEN: "gateway-token" },
          headers: { "cf-aig-authorization": "Bearer gateway-token", authorization: "Bearer provider-token" },
        },
      ]

      for (const item of cases) {
        const result = yield* gatewayRequest(item.model, item.env)
        expect({ case: item.name, ok: result.ok }).toEqual({ case: item.name, ok: true })
        expect({ case: item.name, headers: result.headers }).toEqual({
          case: item.name,
          headers: item.headers,
        })
      }
    }),
  )

  it.effect("reports a configured gateway credential that cannot be resolved", () =>
    Effect.gen(function* () {
      const result = yield* gatewayRequest(
        gateway({ accountId: "test-account", gatewayApiKey: Config.redacted("CF_AIG_GATEWAY_UNSET"), apiKey: "provider-token" }),
        {},
      )

      expect(result.ok).toBe(false)
      expect(result.reason).toBe("InvalidRequest")
      expect(result.headers).toBeUndefined()
    }),
  )

  it.effect("reports a missing gateway credential when no credential resolves", () =>
    Effect.gen(function* () {
      const result = yield* gatewayRequest(gateway({ accountId: "test-account" }), {})

      expect(result.ok).toBe(false)
      expect(result.reason).toBe("Authentication")
      expect(result.headers).toBeUndefined()
    }),
  )

  it.effect("honors an explicit auth override", () =>
    Effect.gen(function* () {
      const result = yield* gatewayRequest(
        gateway({
          accountId: "test-account",
          gatewayApiKey: "gateway-token",
          auth: Auth.header("x-explicit", "explicit-token"),
        }),
        { CLOUDFLARE_API_TOKEN: "gateway-token" },
      )

      expect(result.headers).toEqual({ "x-explicit": "explicit-token" })
    }),
  )
  // kilocode_change end

  it.effect("allows a fully configured baseURL override", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: CloudflareAIGateway.configure({
            baseURL: "https://gateway.proxy.test/v1/custom/compat",
            apiKey: "test-token",
          }).model("openai/gpt-4o-mini"),
          prompt: "Say hello.",
        }),
      )

      expect(prepared.model.route.endpoint.baseURL).toBe("https://gateway.proxy.test/v1/custom/compat")
    }),
  )

  it.effect("prepares direct Workers AI models through the OpenAI-compatible Chat protocol", () =>
    Effect.gen(function* () {
      const model = CloudflareWorkersAI.configure({
        accountId: "test-account",
        apiKey: "test-token",
      }).model("@cf/meta/llama-3.1-8b-instruct")

      expect(model).toMatchObject({
        id: "@cf/meta/llama-3.1-8b-instruct",
        provider: "cloudflare-workers-ai",
        route: { id: "cloudflare-workers-ai" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1")

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("cloudflare-workers-ai")
      expect(prepared.body).toMatchObject({
        model: "@cf/meta/llama-3.1-8b-instruct",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("posts direct Workers AI requests to the account endpoint with bearer auth", () =>
    Effect.gen(function* () {
      const response = yield* LLM.generate(
        LLM.request({
          model: CloudflareWorkersAI.configure({
            accountId: "test-account",
            apiKey: "test-token",
          }).model("@cf/meta/llama-3.1-8b-instruct"),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe("https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/chat/completions")
              expect(web.headers.get("authorization")).toBe("Bearer test-token")
              expect(decodeJson(input.text)).toMatchObject({
                model: "@cf/meta/llama-3.1-8b-instruct",
                stream: true,
                messages: [{ role: "user", content: "Say hello." }],
              })
              return input.respond(
                sseEvents(deltaChunk({ role: "assistant", content: "Hello" }), deltaChunk({}, "stop")),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("Hello")
    }),
  )

  it.effect("supports direct Workers AI token aliases through auth config", () =>
    Effect.gen(function* () {
      yield* LLM.generate(
        LLM.request({
          model: CloudflareWorkersAI.configure({
            accountId: "test-account",
          }).model("@cf/meta/llama-3.1-8b-instruct"),
          prompt: "Say hello.",
        }),
      ).pipe(
        withEnv({ CLOUDFLARE_WORKERS_AI_TOKEN: "test-token" }),
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.headers.get("authorization")).toBe("Bearer test-token")
              return input.respond(
                sseEvents(deltaChunk({ role: "assistant", content: "Hello" }), deltaChunk({}, "stop")),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )
    }),
  )
})
