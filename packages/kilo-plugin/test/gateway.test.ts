import { describe, expect } from "bun:test"
import { KiloErrors } from "@kilocode/gateway-core"
import { EmbeddingCatalog } from "@kilocode/gateway-core/embedding-catalog"
import { fixture } from "@kilocode/gateway-core/testing"
import { isRetryable, LLM, LLMClient } from "@opencode/ai"
import { RequestExecutor } from "@opencode/ai/route"
import { compileRequest } from "@opencode/ai/route/client"
import { httpFailure } from "@opencode/ai/route/executor"
import type { HttpPrepared } from "@opencode/ai/route/transport/http"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { TestClock } from "effect/testing"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { KiloPlugin } from "@opencode/core/plugin/provider/kilo"
import { VerbosityPlugin } from "@opencode/core/plugin/verbosity"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { WebSocketConstructor } from "@opencode/core/effect/websocket-constructor"
import { Agent } from "@opencode/schema/agent"
import { Document, Event, Info } from "@opencode/schema/config"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Session } from "@opencode/schema/session"
import { Global } from "@opencode/util/global"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloPostPlugins } from "../src"
import { KiloGatewayPlugin } from "../src/gateway"
import { GatewayOptions } from "../src/gateway/options"
import { KiloGatewayModel } from "../../kilo-cli/src/gateway-model"

const it = testEffect(PluginTestLayer)
const kilo = Provider.ID.make("kilo")
const integrationID = Integration.ID.make("kilo")
const methodID = Integration.MethodID.make("device")
// Keep the developer environment out of the expected headers.
const env = {
  KILO_API_KEY: undefined,
  KILOCODE_TOKEN: undefined,
  KILO_AUTH_CONTENT: undefined,
  KILO_API_URL: undefined,
  KILO_AI_GATEWAY_URL: undefined,
  KILO_ORG_ID: undefined,
  KILO_MACHINE_ID: undefined,
  KILO_DATA_COLLECTION: undefined,
  KILOCODE_EDITOR_NAME: undefined,
  KILOCODE_FEATURE: undefined,
  KILOCODE_VERSION: undefined,
}
const headers = (team?: string) => ({
  "HTTP-Referer": "https://kilocode.ai",
  "X-Title": "Kilo Code",
  "X-KILOCODE-EDITORNAME": "Kilo CLI unknown",
  "X-KILOCODE-FEATURE": "cli",
  ...(team ? { "X-KILOCODE-ORGANIZATIONID": team } : {}),
})

// Adds the provider with a static models.dev-style seed model (`models-dev/only`), then starts the plugins in
// production order: the upstream built-in `KiloPlugin` (OpenCode referer and title) first, then the Gateway
// plugin, which the Kilo host registers through `SdkPlugins.register` after the built-in list.
const addPlugin = Effect.fn(function* () {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    editor.update(kilo, (provider) => {
      provider.integrationID = integrationID
      provider.package = "@opencode/ai/providers/openai-compatible"
      provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
    })
    editor.models.set(kilo, [Model.Info.default(kilo, Model.ID.make("models-dev/only"))])
  })
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* KiloPlugin.effect(host)
  // The host gives a registered Kilo plugin the global services it requires (packages/kilo-cli/src/host.ts).
  yield* KiloGatewayPlugin.effect(host).pipe(Effect.provide(Global.layerWith({})))
  return host
})

const oauth = (metadata: Record<string, unknown>) =>
  Credential.OAuth.make({ type: "oauth", methodID, access: "token", refresh: "token", expires: 0, metadata })

function eventually<A, E>(effect: Effect.Effect<A, E>, predicate: (value: A) => boolean, remaining = 1000) {
  return Effect.gen(function* (): Effect.fn.Return<A, E | Error> {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

describe("KiloGatewayPlugin", () => {
  it.live("fails explicitly if an embedder does not provide Location config", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      const bus = yield* Bus.Service
      const result = yield* Effect.promise(() =>
        Effect.runPromiseExit(
          Effect.scoped(KiloGatewayPlugin.effect(host)).pipe(
            Effect.provideService(Bus.Service, bus),
            Effect.provide(Global.layerWith({})),
          ),
        ),
      )
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result))
        expect(Cause.squash(result.cause)).toEqual(new Error("Kilo Gateway requires location config"))
    }),
  )

  it.effect("is not in the upstream built-in provider list; the Kilo host registers it", () =>
    Effect.sync(() => {
      expect(ProviderPlugins.map((item) => item.id)).not.toContain(KiloGatewayPlugin.id)
    }),
  )

  // The RPC contract in Schema and the Gateway decoder in the logic package each define the embedding catalog,
  // because neither package may import the other.
  it.effect("declares the embedding catalog of the RPC contract as the Gateway logic decodes it", () =>
    Effect.sync(() => {
      expect(Schema.toJsonSchemaDocument(KiloGatewayRpc.EmbeddingCatalog)).toEqual(
        Schema.toJsonSchemaDocument(EmbeddingCatalog),
      )
    }),
  )

  // v1 never retried PROMOTION_MODEL_LIMIT_REACHED, also when the Gateway sent it with HTTP 429.
  it.effect("stops the upstream retry policy for Kilo errors that need user action", () =>
    Effect.promise(async () => {
      const failure = async (body: unknown, status: number) => {
        const response = await KiloErrors.rewriteHttpResponse(Response.json(body, { status }))
        return httpFailure({
          message: "Provider request failed",
          url: "https://ai-gateway.kilo.ai/api/v1/chat/completions",
          status,
          responseHeaders: Object.fromEntries(response.headers),
          responseBody: await response.text(),
        })
      }
      expect(isRetryable(await failure({ code: "PROMOTION_MODEL_LIMIT_REACHED" }, 429))).toBe(false)
      expect(isRetryable(await failure({ error: { message: "Too Many Requests" } }, 429))).toBe(true)
      expect(isRetryable(await failure({ error: { message: "Request Timeout" } }, 408))).toBe(true)
    }),
  )

  it.live("logs in with the device method and stores the server and the default team", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const backend = fixture()
        // Approve on the first poll so the test does not wait for the 3 second poll interval.
        backend.state.pending = 0
        return backend
      }),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const integrations = yield* Integration.Service
            expect((yield* integrations.get(integrationID))?.methods).toContainEqual({
              id: methodID,
              type: "oauth",
              label: "Kilo Gateway (Device Authorization)",
            })
            const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
            expect(attempt.url).toBe(`${backend.url}/device-auth?code=ABCD-1234`)
            expect(attempt.instructions).toBe("Enter code: ABCD-1234")
            const status = yield* eventually(
              integrations.oauth.status({ integrationID, attemptID: attempt.attemptID }),
              (status) => status.status !== "pending",
            )
            expect(status.status).toBe("complete")
            const credential = (yield* (yield* Credential.Service).list(integrationID))[0]
            expect(credential).toMatchObject({
              label: "device@example.test",
              value: {
                type: "oauth",
                methodID,
                access: "fixture-token",
                refresh: "fixture-token",
                metadata: { server: backend.url, organizationID: "selected", email: "device@example.test" },
              },
            })
            // v1 keeps the token for one year and has no refresh.
            expect(credential?.value.type === "oauth" && credential.value.expires).toBeGreaterThan(
              Date.now() + 364 * 24 * 60 * 60 * 1000,
            )
            const provider = yield* eventually(
              (yield* Provider.Service).get(kilo),
              (provider) => provider?.headers?.["X-KILOCODE-ORGANIZATIONID"] === "selected",
            )
            expect(provider?.settings?.baseURL).toBe(`${backend.url}/api/gateway/v1`)
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("serves only Gateway free models to the anonymous key when signed out and wipes models.dev", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const providers = yield* Provider.Service
            const models = yield* Model.Service
            const provider = yield* providers.get(kilo)
            expect(provider?.activation).toBe("enabled")
            expect(provider?.settings).toMatchObject({ baseURL: `${backend.url}/api/gateway/v1`, apiKey: "anonymous" })
            // Kilo headers only: no OpenCode referer or title.
            expect(provider?.headers).toEqual(headers())
            expect((yield* providers.available()).map((item) => item.id)).toContain(kilo)

            // Only Gateway isFree models are exposed; models.dev seed (`models-dev/only`) and paid models are absent.
            const kiloModels = (yield* models.available()).filter((item) => item.providerID === kilo)
            expect(kiloModels.map((item) => item.id)).toEqual([
              Model.ID.make("kilo-auto/free"),
              Model.ID.make("kilo-auto/small"),
            ])
            expect(yield* models.default()).toMatchObject({
              providerID: kilo,
              id: Model.ID.make("kilo-auto/free"),
            })
            expect(yield* models.small(kilo)).toMatchObject({
              providerID: kilo,
              id: Model.ID.make("kilo-auto/small"),
              settings: { kiloCredentials: false },
            })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("follows the active credential: team catalog, personal catalog, switch and logout", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            const team = yield* credentials.create({
              integrationID,
              label: "team",
              value: oauth({ server: backend.url, organizationID: "selected", email: "a@example.test" }),
            })
            yield* addPlugin()
            const providers = yield* Provider.Service
            const models = yield* Model.Service
            const signedIn = yield* providers.get(kilo)
            expect(signedIn?.headers).toEqual(headers("selected"))
            expect(signedIn?.settings?.baseURL).toBe(`${backend.url}/api/gateway/v1`)
            expect(signedIn?.settings).not.toHaveProperty("apiKey")
            expect(signedIn?.activation).toBe("auto")
            expect(
              (yield* models.available())
                .filter((item) => item.providerID === kilo)
                .map((item) => item.id),
            ).toEqual([Model.ID.make("anthropic/claude-sonnet-4.6"), Model.ID.make("kilo-auto/small")])
            const available = yield* models.available()
            expect(available.find((item) => item.id === "kilo-auto/small")?.settings?.kiloCredentials).toBe(true)
            const sonnet = available.find(
              (item) => item.providerID === kilo && item.id === Model.ID.make("anthropic/claude-sonnet-4.6"),
            )
            // kilo_port(gateway:5187eb3f1516) Kilo models use the Gateway dialect of each model, as the v1 Kilo SDK did.
            expect(sonnet?.package).toBe("@opencode/ai/providers/anthropic")
            expect(
              available.find((item) => item.providerID === kilo && item.id === Model.ID.make("kilo-auto/small"))?.package,
            ).toBe("@opencode/ai/providers/openrouter")
            // kilo_port(gateway:d29cb22ad5f6) Server-provided variants, now resolved from the Gateway reasoning_options.
            expect(sonnet?.variants.map((variant) => variant.id)).toEqual([
              Model.VariantID.make("low"),
              Model.VariantID.make("medium"),
              Model.VariantID.make("high"),
              Model.VariantID.make("max"),
            ])
            expect(sonnet?.variants.find((variant) => variant.id === Model.VariantID.make("high"))?.settings).toMatchObject({
              thinking: { type: "adaptive", display: "summarized" },
              effort: "high",
            })
            expect(yield* models.default()).toMatchObject({
              providerID: kilo,
              id: Model.ID.make("anthropic/claude-sonnet-4.6"),
            })

            const personal = yield* credentials.create({
              integrationID,
              label: "personal",
              value: oauth({ server: backend.url, organizationID: null, email: "a@example.test" }),
            })
            expect(
              (yield* eventually(
                providers.get(kilo),
                (provider) => provider?.activation === "auto" && !provider.headers?.["X-KILOCODE-ORGANIZATIONID"],
              ))?.headers,
            ).toEqual(headers())
            expect(
              (yield* models.available())
                .filter((item) => item.providerID === kilo)
                .map((item) => item.id),
            ).toEqual([
              Model.ID.make("kilo-auto/free"),
              Model.ID.make("kilo-auto/frontier"),
              Model.ID.make("kilo-auto/small"),
            ])
            expect(yield* models.default()).toMatchObject({
              providerID: kilo,
              id: Model.ID.make("kilo-auto/frontier"),
            })

            yield* credentials.remove(personal.id)
            yield* credentials.remove(team.id)
            const signedOut = yield* eventually(providers.get(kilo), (provider) => provider?.activation === "enabled")
            expect(signedOut?.settings?.apiKey).toBe("anonymous")
            expect((yield* models.get(kilo, Model.ID.make("kilo-auto/small")))?.settings?.kiloCredentials).toBe(false)
            expect(
              (yield* models.available())
                .filter((item) => item.providerID === kilo)
                .map((item) => item.id),
            ).toEqual([Model.ID.make("kilo-auto/free"), Model.ID.make("kilo-auto/small")])
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("keeps the usable catalog and request auth during a same-scope refresh", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "refresh-token" }, () =>
          Effect.gen(function* () {
            const host = yield* addPlugin()
            const models = yield* Model.Service
            const before = (yield* models.available()).filter((model) => model.providerID === kilo)
            backend.requests.length = 0
            let releaseRefresh: () => void = () => {}
            backend.state.profilePending = new Promise<void>((resolve) => { releaseRefresh = resolve })
            const catalog = backend.state.models as { data: { id: string }[] }
            backend.state.models = { data: catalog.data.filter((model) => model.id !== "kilo-auto/frontier") }
            const bus = yield* Bus.Service
            yield* bus.publish(Event.Updated, {})
            yield* eventually(
              Effect.sync(() => backend.requests.some((request) => request.path === "/api/profile")),
              Boolean,
            )
            expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual(before)
            const session = yield* host.session.create({ title: "refresh" })
            const hooks = yield* PluginHooks.Service
            const request = yield* hooks.trigger("session", "http.request", {
              sessionID: session.id,
              agent: Agent.ID.make("code"),
              model: { providerID: kilo, id: Model.ID.make("kilo-auto/free") },
              kind: "primary",
              request: new Request(`${backend.url}/api/gateway/v1/chat/completions`, {
                method: "POST",
                body: "{}",
              }),
            })
            expect(request.request.headers.get("authorization")).toBe("Bearer refresh-token")
            releaseRefresh()
            yield* eventually(
              models.available(),
              (list) => !list.some((model) => model.providerID === kilo && model.id === Model.ID.make("kilo-auto/frontier")),
            )
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("invalidates an anonymous endpoint change even after another resolver read and overlapping config events", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => ({ first: fixture(), second: fixture() })),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.first.url }, () =>
          Effect.gen(function* () {
            const host = yield* addPlugin()
            const session = yield* host.session.create({ title: "anonymous endpoint" })
            const hooks = yield* PluginHooks.Service
            const common = {
              sessionID: session.id,
              agent: Agent.ID.make("code"),
              model: { providerID: kilo, id: Model.ID.make("kilo-auto/free") },
              kind: "primary" as const,
            }
            let releaseEndpoint: () => void = () => {}
            backend.second.state.modelsPending = new Promise<void>((resolve) => { releaseEndpoint = resolve })
            const config = yield* Config.Test
            yield* config.setEntries([
              new Document({
                type: "document",
                info: Schema.decodeUnknownSync(Info)({ providers: { kilo: { settings: { baseURL: backend.second.url } } } }),
              }),
            ])
            const rpc = yield* Rpc.Service
            yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: null }).pipe(Effect.flip)
            expect((yield* hooks.trigger("session", "model.request", { ...common, headers: {} })).baseURL)
              .toBe(`${backend.first.url}/api/gateway/v1`)
            const bus = yield* Bus.Service
            yield* bus.publish(Event.Updated, {})
            yield* bus.publish(Event.Updated, {})
            yield* eventually(
              Effect.sync(() => backend.second.requests.some((request) => request.path.endsWith("/models"))),
              Boolean,
            )
            const models = yield* Model.Service
            expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual([])
            const request = yield* hooks.trigger("session", "http.request", {
              ...common,
              request: new Request(`${backend.first.url}/api/gateway/v1/chat/completions`),
            }).pipe(Effect.exit)
            expect(Exit.isFailure(request)).toBe(true)
            releaseEndpoint()
            yield* eventually(models.available(), (list) => list.some((model) => model.providerID === kilo))
            const providers = yield* Provider.Service
            expect((yield* providers.get(kilo))?.settings?.baseURL).toBe(`${backend.second.url}/api/openrouter`)
          }),
        ),
      (backend) => Effect.sync(() => {
        backend.first[Symbol.dispose]()
        backend.second[Symbol.dispose]()
      }),
    ),
  )

  it.live("keeps the current anonymous endpoint when a superseded provider reload resumes", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => ({ first: fixture(), second: fixture() })),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.first.url }, () =>
          Effect.gen(function* () {
            const providers = yield* Provider.Service
            yield* providers.transform((editor) => {
              editor.update(kilo, (provider) => {
                provider.integrationID = integrationID
                provider.package = "@opencode/ai/providers/openai-compatible"
                provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
              })
            })
            const plugin = yield* Plugin.Service
            const host = yield* PluginHost.make(plugin)
            const paused = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>()
            const release = yield* Deferred.make<void>()
            let pauseNextReload = false
            yield* KiloPlugin.effect(host)
            yield* KiloGatewayPlugin.effect({
              ...host,
              provider: {
                ...host.provider,
                reload: () => Effect.gen(function* () {
                  yield* host.provider.reload()
                  if (!pauseNextReload) return
                  pauseNextReload = false
                  const fiber = yield* Effect.fiber
                  yield* Deferred.succeed(paused, fiber)
                  yield* Deferred.await(release)
                }),
              },
            }).pipe(Effect.provide(Global.layerWith({})))
            const models = yield* Model.Service
            const before = (yield* models.available()).filter((model) => model.providerID === kilo)
            expect(before).toHaveLength(2)
            const session = yield* host.session.create({ title: "superseded endpoint" })
            const hooks = yield* PluginHooks.Service
            const common = {
              sessionID: session.id,
              agent: Agent.ID.make("code"),
              model: { providerID: kilo, id: Model.ID.make("kilo-auto/free") },
              kind: "primary" as const,
            }
            const config = yield* Config.Test
            yield* config.setEntries([
              new Document({
                type: "document",
                info: Schema.decodeUnknownSync(Info)({ providers: { kilo: { settings: { baseURL: backend.second.url } } } }),
              }),
            ])
            const bus = yield* Bus.Service
            pauseNextReload = true
            yield* bus.publish(Event.Updated, {})
            const stale = yield* Deferred.await(paused)
            expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual([])
            yield* config.setEntries([])
            yield* bus.publish(Event.Updated, {})
            yield* eventually(models.available(), (list) => list.some((model) => model.providerID === kilo))
            expect((yield* hooks.trigger("session", "model.request", { ...common, headers: {} })).baseURL)
              .toBe(`${backend.first.url}/api/gateway/v1`)
            yield* Deferred.succeed(release, undefined)
            expect(Exit.isSuccess(yield* Fiber.await(stale))).toBe(true)
            expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual(before)
            expect((yield* hooks.trigger("session", "model.request", { ...common, headers: {} })).baseURL)
              .toBe(`${backend.first.url}/api/gateway/v1`)
            expect((yield* providers.get(kilo))?.settings?.baseURL).toBe(`${backend.first.url}/api/gateway/v1`)
            expect(backend.second.requests).toEqual([])
          }),
        ),
      (backend) => Effect.sync(() => {
        backend.first[Symbol.dispose]()
        backend.second[Symbol.dispose]()
      }),
    ),
  )

  it.live("does not restore a superseded personal catalog after its snapshot write completes", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const config = yield* Config.Test
            yield* config.setEntries([
              new Document({
                type: "document",
                info: Schema.decodeUnknownSync(Info)({ providers: { kilo: { settings: { apiKey: "first-token" } } } }),
              }),
            ])
            const providers = yield* Provider.Service
            yield* providers.transform((editor) => {
              editor.update(kilo, (provider) => {
                provider.integrationID = integrationID
                provider.package = "@opencode/ai/providers/openai-compatible"
                provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
              })
            })
            const plugin = yield* Plugin.Service
            const host = yield* PluginHost.make(plugin)
            const paused = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>()
            const release = yield* Deferred.make<void>()
            const invalidated = yield* Deferred.make<void>()
            let pauseNextSnapshot = false
            let observeInvalidation = false
            yield* KiloPlugin.effect(host)
            yield* KiloGatewayPlugin.effect({
              ...host,
              storage: {
                ...host.storage,
                set: (key, value) => Effect.gen(function* () {
                  yield* host.storage.set(key, value)
                  if (!pauseNextSnapshot || !key.startsWith("catalog:personal:")) return
                  pauseNextSnapshot = false
                  const fiber = yield* Effect.fiber
                  yield* Deferred.succeed(paused, fiber)
                  yield* Deferred.await(release)
                }),
              },
              provider: {
                ...host.provider,
                reload: () => Effect.gen(function* () {
                  yield* host.provider.reload()
                  if (!observeInvalidation) return
                  observeInvalidation = false
                  yield* Deferred.succeed(invalidated, undefined)
                }),
              },
            }).pipe(Effect.provide(Global.layerWith({})))
            const session = yield* host.session.create({ title: "superseded snapshot" })
            const hooks = yield* PluginHooks.Service
            const common = {
              sessionID: session.id,
              agent: Agent.ID.make("code"),
              model: { providerID: kilo, id: Model.ID.make("kilo-auto/small") },
              kind: "primary" as const,
            }
            const models = yield* Model.Service
            expect((yield* models.available()).filter((model) => model.providerID === kilo)).toHaveLength(3)
            const bus = yield* Bus.Service
            pauseNextSnapshot = true
            yield* bus.publish(Event.Updated, {})
            const stale = yield* Deferred.await(paused)
            const profile = Promise.withResolvers<void>()
            backend.state.profilePending = profile.promise
            yield* config.setEntries([
              new Document({
                type: "document",
                info: Schema.decodeUnknownSync(Info)({
                  providers: { kilo: { settings: { apiKey: "second-token", kilocodeOrganizationId: "selected" } } },
                }),
              }),
            ])
            observeInvalidation = true
            yield* bus.publish(Event.Updated, {})
            yield* Deferred.await(invalidated)
            expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual([])
            yield* Deferred.succeed(release, undefined)
            expect(Exit.isSuccess(yield* Fiber.await(stale))).toBe(true)
            yield* eventually(
              Effect.sync(() => backend.requests.some((request) => request.path === "/api/profile" && request.authorization === "Bearer second-token")),
              Boolean,
            )
            const rpc = yield* Rpc.Service
            expect(Exit.isFailure(yield* rpc.call("kilocode.gateway", "models", {}).pipe(Effect.exit))).toBe(true)
            expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toMatchObject({ authenticated: false })
            expect(Exit.isFailure(yield* hooks.trigger("session", "http.request", {
              ...common,
              request: new Request(`${backend.url}/api/gateway/v1/chat/completions`),
            }).pipe(Effect.exit))).toBe(true)
            profile.resolve()
            yield* eventually(providers.get(kilo), (provider) => provider?.settings?.apiKey === "second-token")
            expect((yield* models.available()).filter((model) => model.providerID === kilo).map((model) => model.id))
              .toEqual([Model.ID.make("anthropic/claude-sonnet-4.6"), Model.ID.make("kilo-auto/small")])
            const request = yield* hooks.trigger("session", "http.request", {
              ...common,
              request: new Request(`${backend.url}/api/gateway/v1/chat/completions`),
            })
            expect(request.request.headers.get("authorization")).toBe("Bearer second-token")
            expect(request.request.headers.get("x-kilocode-organizationid")).toBe("selected")
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("invalidates an in-flight scope when another credential is selected", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv(env, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            const first = yield* credentials.create({
              integrationID,
              label: "first",
              value: Credential.OAuth.make({
                ...oauth({ server: backend.url, organizationID: "first" }),
                access: "first-token",
                refresh: "first-token",
              }),
            })
            const providers = yield* Provider.Service
            const winning = yield* Deferred.make<void>()
            let observeWinning = false
            const host = yield* addPlugin().pipe(Effect.provideService(Provider.Service, {
              ...providers,
              reload: () => Effect.gen(function* () {
                yield* providers.reload()
                if (!observeWinning) return
                observeWinning = false
                yield* Deferred.succeed(winning, undefined)
              }),
            }))
            backend.requests.length = 0
            const profile = Promise.withResolvers<void>()
            backend.state.profilePending = profile.promise
            yield* credentials.create({
              integrationID,
              label: "second",
              value: Credential.OAuth.make({
                ...oauth({ server: backend.url, organizationID: "selected" }),
                access: "second-token",
                refresh: "second-token",
              }),
            })
            yield* eventually(
              Effect.sync(() => backend.requests.some((request) => request.path === "/api/profile" && request.authorization === "Bearer second-token")),
              Boolean,
            )
            observeWinning = true
            yield* credentials.activate(first.id)
            yield* Deferred.await(winning)
            profile.resolve()
            yield* eventually(
              providers.get(kilo),
              (provider) =>
                provider?.activation === "auto" && provider.headers?.["X-KILOCODE-ORGANIZATIONID"] === "first",
            )
            expect(backend.requests.some((request) => request.path === "/api/organizations/selected/models")).toBe(
              false,
            )
            expect(backend.requests.filter((request) => request.path.endsWith("/models")).every((request) => request.authorization === "Bearer first-token"))
              .toBe(true)
            const session = yield* host.session.create({ title: "winning credential" })
            const hooks = yield* PluginHooks.Service
            const request = yield* hooks.trigger("session", "http.request", {
              sessionID: session.id,
              agent: Agent.ID.make("code"),
              model: { providerID: kilo, id: Model.ID.make("kilo-auto/small") },
              kind: "primary",
              request: new Request(`${backend.url}/api/gateway/v1/chat/completions`),
            })
            expect(request.request.headers.get("authorization")).toBe("Bearer first-token")
            expect(request.request.headers.get("x-kilocode-organizationid")).toBe("first")
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("keeps the last good personal catalog on failure and fails closed on team catalog failure", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID,
              label: "a@example.test",
              value: oauth({ server: backend.url, organizationID: null, email: "a@example.test" }),
            })
            yield* addPlugin()
            const models = yield* Model.Service
            const rpc = yield* Rpc.Service
            expect(
              (yield* models.available())
                .filter((item) => item.providerID === kilo)
                .map((item) => item.id),
            ).toEqual([
              Model.ID.make("kilo-auto/free"),
              Model.ID.make("kilo-auto/frontier"),
              Model.ID.make("kilo-auto/small"),
            ])

            // Team catalog fails (403): fail closed with 0 Kilo models (never personal or models.dev models).
            backend.state.teamModelsStatus = 403
            expect(yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: "selected" }).pipe(Effect.flip))
              .toMatchObject({ type: "failed" })
            expect((yield* models.available()).filter((item) => item.providerID === kilo)).toEqual([])
            expect(yield* rpc.call("kilocode.gateway", "models", {}).pipe(Effect.flip)).toMatchObject({
              type: "failed",
            })

            // Switching back to personal when `/api/openrouter/models` is down (503) serves the last good personal list.
            backend.state.modelsStatus = 503
            yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: null })
            expect(
              (yield* models.available())
                .filter((item) => item.providerID === kilo)
                .map((item) => item.id),
            ).toEqual([
              Model.ID.make("kilo-auto/free"),
              Model.ID.make("kilo-auto/frontier"),
              Model.ID.make("kilo-auto/small"),
            ])
            const metadata = (yield* rpc.call(
              "kilocode.gateway",
              "models",
              {},
            )) as readonly KiloGatewayRpc.ModelEntry[]
            expect(metadata.find((entry) => entry.id === "kilo-auto/frontier")).toMatchObject({
              id: "kilo-auto/frontier",
              isFree: false,
              recommendedIndex: 0,
              hasUserByokAvailable: true,
              mayTrainOnYourPrompts: false,
            })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.effect("a stale policy lookup cannot cancel the latest catalog retry", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "fixture-token", KILO_ORG_ID: "selected" }, () =>
          Effect.gen(function* () {
            const config = yield* Config.Service
            const entered = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            let stall = false
            const providers = yield* Provider.Service
            yield* providers.transform((editor) => {
              editor.update(kilo, (provider) => {
                provider.integrationID = integrationID
              })
            })
            const plugins = yield* Plugin.Service
            const host = yield* PluginHost.make(plugins)
            yield* KiloPlugin.effect(host)
            yield* KiloGatewayPlugin.effect(host).pipe(
              Effect.provideService(Config.Service, {
                ...config,
                entries: () =>
                  Effect.gen(function* () {
                    const entries = yield* config.entries()
                    if (!stall) return entries
                    stall = false
                    yield* Deferred.succeed(entered, undefined)
                    yield* Deferred.await(release)
                    return entries
                  }),
              }),
              Effect.provide(Global.layerWith({})),
            )
            const gateway = host.rpc(KiloGatewayRpc.Definition)
            expect((yield* gateway.models({})).map((model) => model.id)).toEqual([
              "anthropic/claude-sonnet-4.6",
              "kilo-auto/small",
            ])

            // Reload A waits before the catalog lock while reload B fails and schedules its own retry.
            stall = true
            const stale = yield* gateway["organization.set"]({ organizationID: "selected" }).pipe(
              Effect.forkChild({ startImmediately: true }),
            )
            yield* Deferred.await(entered)
            backend.state.teamModelsStatus = 503
            // A failed catalog rejects the scope change after selecting it, matching the typed RPC contract.
            expect(yield* gateway["organization.set"]({ organizationID: "selected" }).pipe(Effect.flip))
              .toMatchObject({ type: "failed" })
            expect(yield* gateway.models({}).pipe(Effect.flip)).toMatchObject({ type: "failed" })

            // Let the superseded reload finish while the catalog still fails, so only the newer retry can recover.
            yield* Deferred.succeed(release, undefined)
            // The superseded RPC may fail after its stale catalog request; only its side effects matter here.
            yield* Fiber.await(stale)
            const requests = backend.requests.filter((request) => request.path.endsWith("/models")).length
            backend.state.teamModelsStatus = 200
            yield* TestClock.adjust("30 seconds")
            const recovered = yield* eventually(
              gateway.models({}).pipe(Effect.orElseSucceed(() => [])),
              (models) => models.length > 0,
            )
            expect(recovered.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-4.6", "kilo-auto/small"])
            expect(backend.requests.filter((request) => request.path.endsWith("/models"))).toHaveLength(requests + 1)
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )
  it.live("uses an aliased model family once and preserves a custom agent system prompt", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) => withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "token" }, () =>
        Effect.gen(function* () {
          backend.state.models = { data: [{
            id: "kilo-auto/frontier", name: "Claude alias", context_length: 128000,
            opencode: { family: "claude", ai_sdk_provider: "anthropic" },
          }] }
          const host = yield* addPlugin()
          yield* host.agent.transform((editor) => editor.update("code", (agent) => { agent.system = undefined }))
          const models = yield* Model.Service
          expect((yield* models.available()).find((model) => model.id === "kilo-auto/frontier")?.family).toBe(Model.Family.make("claude"))
          expect((yield* host.agent.get({ agentID: Agent.ID.make("code") })).data.system).toBeUndefined()
          const session = yield* host.session.create({ title: "Prompt precedence" })
          const hooks = yield* PluginHooks.Service
          const input = {
            sessionID: session.id, agent: Agent.ID.make("code"),
            model: { providerID: kilo, id: Model.ID.make("kilo-auto/frontier") },
            messages: [], tools: {}, options: {},
          }
          const aliased = yield* hooks.trigger("session", "context", { ...input, system: [{ type: "text", text: "BASE" }] })
          expect(aliased.system[0]?.text).toContain("match the surrounding comment density")
          expect(aliased.system[0]?.text.split("# Code comments")).toHaveLength(2)
          yield* host.agent.transform((editor) => editor.update("code", (agent) => {
            agent.system = "CUSTOM-GATEWAY-SYSTEM"
          }))
          const custom = yield* hooks.trigger("session", "context", {
            ...input, system: [{ type: "text", text: "CUSTOM-GATEWAY-SYSTEM" }],
          })
          expect(custom.system[0]?.text).toBe("CUSTOM-GATEWAY-SYSTEM")
        }),
      ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("retains credential presence when a personal 401 falls back to a free small-router catalog", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const backend = fixture()
        const proxy = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            if (request.headers.get("authorization") === "Bearer expired") return new Response(null, { status: 401 })
            return fetch(new Request(new URL(new URL(request.url).pathname, backend.url), request))
          },
        })
        return {
          url: proxy.url.origin,
          [Symbol.dispose]() {
            proxy.stop(true)
            backend[Symbol.dispose]()
          },
        }
      }),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "expired" }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const models = yield* Model.Service
            expect((yield* models.get(kilo, Model.ID.make("kilo-auto/small")))?.settings).toMatchObject({
              apiKey: "anonymous",
              kiloCredentials: true,
            })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  for (const status of [200, 503]) {
    it.live(`selects the first allowed team model when defaults are ${status === 200 ? "empty" : "unavailable"}`, () =>
      Effect.acquireUseRelease(
        Effect.sync(() => fixture()),
        (backend) =>
          withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "token", KILO_ORG_ID: "selected" }, () =>
            Effect.gen(function* () {
              backend.state.teamModels = {
                data: [
                  { id: "anthropic/claude-X", name: "First allowed", context_length: 128000 },
                  { id: "kilo-auto/frontier", name: "Personal fallback also allowed", context_length: 128000 },
                ],
              }
              backend.state.teamDefaults = {}
              backend.state.teamDefaultsStatus = status
              yield* addPlugin()
              const models = yield* Model.Service
              expect(
                (yield* models.available()).filter((model) => model.providerID === kilo).map((model) => model.id),
              ).toEqual([Model.ID.make("anthropic/claude-X"), Model.ID.make("kilo-auto/frontier")])
              expect(yield* models.default()).toMatchObject({
                providerID: kilo,
                id: Model.ID.make("anthropic/claude-X"),
              })
            }),
          ),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      ),
    )
  }

  for (const dialect of [
    {
      provider: "anthropic",
      model: "anthropic/claude-sonnet-4.6",
      route: "anthropic-messages",
      lowered: { thinking: { type: "adaptive" }, effort: "low" },
      native: { thinking: { type: "disabled" }, effort: "high" },
      sharedBody: { thinking: { type: "adaptive" }, output_config: { effort: "low" } },
      nativeBody: { thinking: { type: "disabled" }, output_config: { effort: "high" } },
    },
    {
      provider: "openai",
      model: "openai/gpt-5.4",
      route: "openai-responses",
      lowered: { reasoningEffort: "high", textVerbosity: "low", forceReasoning: true },
      native: { reasoningEffort: "low", textVerbosity: "high", forceReasoning: false, store: true },
      sharedBody: { reasoning: { effort: "high" }, text: { verbosity: "low" }, store: false },
      nativeBody: { reasoning: { effort: "low" }, text: { verbosity: "high" }, store: true },
    },
    {
      provider: "openai-compatible",
      model: "test/compatible",
      route: "openai-compatible-chat",
      lowered: { reasoningEffort: "high", textVerbosity: "low" },
      native: { reasoningEffort: "low", textVerbosity: "high" },
      sharedBody: { reasoning_effort: "high" },
      nativeBody: { reasoning_effort: "low" },
    },
  ]) {
    for (const reasoning of [true, false]) {
      it.live(
        `uses explicit ${dialect.provider} variants over reasoning_options with reasoning capability ${reasoning}`,
        () =>
          Effect.acquireUseRelease(
            Effect.sync(() => {
              const backend = fixture()
              const gateway = Bun.serve({
                hostname: "127.0.0.1",
                port: 0,
                async fetch(request) {
                  if (request.method === "POST") return Response.json(await request.json())
                  return fetch(new Request(new URL(new URL(request.url).pathname, backend.url), request))
                },
              })
              return {
                ...backend,
                url: gateway.url.origin,
                [Symbol.dispose]() {
                  gateway.stop(true)
                  backend[Symbol.dispose]()
                },
              }
            }),
            (backend) =>
              withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "token" }, () =>
                Effect.gen(function* () {
                  const shared = { reasoning: { enabled: true, effort: "high" }, verbosity: "low" }
                  backend.state.models = {
                    data: [
                      {
                        id: dialect.model,
                        name: "Backend variants",
                        context_length: 128000,
                        supported_parameters: ["tools", ...(reasoning ? ["reasoning"] : [])],
                        opencode: {
                          ai_sdk_provider: dialect.provider,
                          reasoning_options: [{ type: "effort", values: ["medium"] }],
                          variants: {
                            default: shared,
                            "": shared,
                            "team-custom": shared,
                            "native-custom": { ...shared, ...dialect.native },
                            "deep#careful": { ...shared, ...dialect.native },
                          },
                        },
                      },
                    ],
                  }
                  const host = yield* addPlugin()
                  const models = yield* Model.Service
                  const model = yield* models.get(kilo, Model.ID.make(dialect.model))
                  expect(model?.package).toBe(`@opencode/ai/providers/${dialect.provider}`)
                  expect(model?.variants).toEqual([
                    { id: Model.VariantID.make("team-custom"), settings: { ...shared, ...dialect.lowered } },
                    { id: Model.VariantID.make("native-custom"), settings: { ...shared, ...dialect.native } },
                    { id: Model.VariantID.make("deep#careful"), settings: { ...shared, ...dialect.native } },
                  ])
                  const session = yield* host.session.create({ title: "variant lowering" })
                  const hooks = yield* PluginHooks.Service
                  yield* Effect.gen(function* () {
                    const resolver = yield* ModelResolver.Service
                    for (const variant of [
                      { id: "team-custom", body: dialect.sharedBody },
                      { id: "native-custom", body: dialect.nativeBody },
                      { id: "deep#careful", body: dialect.nativeBody },
                    ]) {
                      const resolved = yield* resolver.resolve({
                        providerID: kilo,
                        id: Model.ID.make(dialect.model),
                        variant: Model.VariantID.make(variant.id),
                      })
                      expect(resolved).toBeDefined()
                      const context = yield* hooks.trigger("session", "context", {
                        sessionID: session.id,
                        agent: Agent.ID.make("code"),
                        model: resolved!.ref,
                        system: [],
                        messages: [],
                        tools: {},
                        options: {},
                      })
                      const input = LLM.request({
                        model: resolved!.model,
                        prompt: "Hello",
                        providerOptions: context.options,
                      })
                      const request = yield* compileRequest(input)
                      expect(request.route).toBe(dialect.route)
                      expect(request.body).toMatchObject({ model: dialect.model, ...variant.body })
                      const prepared: HttpPrepared<string> | { readonly http: HttpPrepared<string> } =
                        yield* resolved!.model.route.prepareTransport(request.body, input)
                      const outgoing = yield* hooks.trigger("session", "http.request", {
                        sessionID: session.id,
                        agent: Agent.ID.make("code"),
                        model: resolved!.ref,
                        kind: "primary",
                        request: yield* HttpClientRequest.toWeb(
                          "http" in prepared ? prepared.http.request : prepared.request,
                        ),
                      })
                      expect(outgoing.request.headers.get("authorization")).toBe("Bearer token")
                      const received = yield* Effect.promise(() => fetch(outgoing.request))
                      expect(received.status).toBe(200)
                      expect(yield* Effect.promise(() => received.json())).toMatchObject({
                        model: dialect.model,
                        ...variant.body,
                      })
                    }
                  }).pipe(Effect.provide(ModelResolver.layer))
                  expect((yield* models.get(kilo, Model.ID.make(dialect.model)))?.variants).toEqual(model?.variants)
                }),
              ),
            (backend) => Effect.sync(() => backend[Symbol.dispose]()),
          ),
      )
    }
  }

  it.live(
    "uses reasoning_options when explicit variants are empty and keeps non-reasoning models without variants",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => fixture()),
        (backend) =>
          withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "token" }, () =>
            Effect.gen(function* () {
              backend.state.models = {
                data: [true, false].map((reasoning) => ({
                  id: `test/empty-variants-${reasoning}`,
                  name: "Empty explicit variants",
                  context_length: 128000,
                  supported_parameters: ["tools", ...(reasoning ? ["reasoning"] : [])],
                  opencode: {
                    ai_sdk_provider: "openai-compatible",
                    variants: {},
                    reasoning_options: [{ type: "effort", values: ["low", "high"] }],
                  },
                })),
              }
              yield* addPlugin()
              const models = yield* Model.Service
              expect(
                (yield* models.get(kilo, Model.ID.make("test/empty-variants-true")))?.variants.map(
                  (variant) => variant.id,
                ),
              ).toEqual([Model.VariantID.make("low"), Model.VariantID.make("high")])
              expect((yield* models.get(kilo, Model.ID.make("test/empty-variants-false")))?.variants).toEqual([])
            }),
          ),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      ),
  )

  it.live("uses high reasoning for Gemini 3 by default but lets the selected explicit variant override it", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "token" }, () =>
          Effect.gen(function* () {
            backend.state.models = {
              data: ["openrouter", "openai-compatible"].map((provider) => ({
                id: `google/gemini-3-${provider}`,
                name: "Gateway Gemini 3",
                context_length: 128000,
                supported_parameters: ["tools", "reasoning"],
                opencode: { ai_sdk_provider: provider, variants: { quiet: { reasoning: { effort: "low" } } } },
              })),
            }
            const host = yield* addPlugin()
            const session = yield* host.session.create({ title: "Gemini reasoning defaults" })
            const models = yield* Model.Service
            const hooks = yield* PluginHooks.Service
            yield* Effect.gen(function* () {
              const resolver = yield* ModelResolver.Service
              for (const provider of ["openrouter", "openai-compatible"]) {
                const id = Model.ID.make(`google/gemini-3-${provider}`)
                expect((yield* models.get(kilo, id))?.settings).toMatchObject({ reasoning: { effort: "high" } })
                for (const variant of [undefined, Model.VariantID.make("quiet")]) {
                  const model = { providerID: kilo, id, ...(variant ? { variant } : {}) }
                  const context = yield* hooks.trigger("session", "context", {
                    sessionID: session.id,
                    agent: Agent.ID.make("code"),
                    model,
                    system: [],
                    messages: [],
                    tools: {},
                    options: {},
                  })
                  const effort = variant ? "low" : "high"
                  expect(context.options).toMatchObject({ reasoning: { effort } })
                  const resolved = yield* resolver.resolve(model)
                  const request = yield* compileRequest(
                    LLM.request({ model: resolved!.model, prompt: "Hello", providerOptions: context.options }),
                  )
                  expect(request.body).toMatchObject(
                    provider === "openrouter" ? { reasoning: { effort } } : { reasoning_effort: effort },
                  )
                }
              }
            }).pipe(Effect.provide(ModelResolver.layer))
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  for (const dialect of [
    {
      provider: "anthropic",
      native: { thinking: { type: "adaptive" }, effort: "low" },
      body: { thinking: { type: "adaptive" }, output_config: { effort: "low" } },
    },
    {
      provider: "openai",
      native: { reasoningEffort: "high", textVerbosity: "low", forceReasoning: true },
      body: { reasoning: { effort: "high" }, text: { verbosity: "low" } },
    },
    {
      provider: "openai-compatible",
      native: { reasoningEffort: "high", textVerbosity: "low" },
      body: { reasoning_effort: "high" },
    },
  ]) {
    it.live(`lowers shared ${dialect.provider} config and event options through every session request hook`, () =>
      Effect.acquireUseRelease(
        Effect.sync(() => fixture()),
        (backend) =>
          withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "token" }, () =>
            Effect.gen(function* () {
              const id = Model.ID.make(`test/${dialect.provider}-config`)
              backend.state.models = {
                data: [
                  {
                    id,
                    name: "Shared config",
                    context_length: 128000,
                    opencode: { ai_sdk_provider: dialect.provider },
                  },
                ],
              }
              const host = yield* addPlugin()
              const session = yield* host.session.create({ title: "Shared config lowering" })
              const providers = yield* Provider.Service
              yield* providers.transform((editor) =>
                editor.update(kilo, (provider) => {
                  provider.settings = {
                    ...provider.settings,
                    reasoning: { enabled: true, effort: "high" },
                    verbosity: "low",
                  }
                }),
              )
              const hooks = yield* PluginHooks.Service
              yield* Effect.gen(function* () {
                const resolver = yield* ModelResolver.Service
                const resolved = yield* resolver.resolve({ providerID: kilo, id })
                for (const hook of ["context", "compaction", "generate", "title"] as const) {
                  const context = yield* hooks.trigger("session", hook, {
                    sessionID: session.id,
                    agent: Agent.ID.make("code"),
                    model: { providerID: kilo, id },
                    system: [],
                    messages: [],
                    tools: {},
                    options: { temperature: 0.25 },
                  })
                  expect(context.options).toMatchObject({ temperature: 0.25, ...dialect.native })
                  expect(context.options).not.toHaveProperty("apiKey")
                  expect(context.options).not.toHaveProperty("baseURL")
                  const request = yield* compileRequest(
                    LLM.request({ model: resolved!.model, prompt: "Hello", providerOptions: context.options }),
                  )
                  expect(request.body).toMatchObject(dialect.body)
                  const override = yield* hooks.trigger("session", hook, {
                    sessionID: session.id,
                    agent: Agent.ID.make("code"),
                    model: { providerID: kilo, id },
                    system: [],
                    messages: [],
                    tools: {},
                    options: { reasoning: { enabled: false, effort: "medium" }, verbosity: "high" },
                  })
                  expect(override.options).toMatchObject(
                    dialect.provider === "anthropic"
                      ? { thinking: { type: "disabled" }, effort: "high" }
                      : {
                          reasoningEffort: "medium",
                          textVerbosity: "high",
                          ...(dialect.provider === "openai" ? { forceReasoning: false } : {}),
                        },
                  )
                }
              }).pipe(Effect.provide(ModelResolver.layer))
            }),
          ),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      ),
    )
  }

  for (const selection of [
    { name: "provider shared high", provider: { verbosity: "high" }, expected: "high" },
    {
      name: "model shared medium",
      provider: { verbosity: "high" },
      model: { verbosity: "medium" },
      expected: "medium",
    },
    { name: "variant shared high", model: { verbosity: "medium" }, variant: { verbosity: "high" }, expected: "high" },
    { name: "native model low", model: { verbosity: "high", textVerbosity: "low" }, expected: "low" },
    {
      name: "native variant low",
      model: { verbosity: "high" },
      variant: { verbosity: "medium", textVerbosity: "low" },
      expected: "low",
    },
    {
      name: "model shared over provider native",
      provider: { textVerbosity: "low" },
      model: { verbosity: "high" },
      expected: "high",
    },
    {
      name: "variant shared over model native",
      model: { textVerbosity: "low" },
      variant: { verbosity: "medium" },
      expected: "medium",
    },
    {
      name: "explicit request native low",
      model: { verbosity: "high" },
      options: { textVerbosity: "low" },
      expected: "low",
    },
    {
      name: "explicit request native high",
      model: { verbosity: "medium" },
      options: { textVerbosity: "high" },
      expected: "high",
    },
    {
      name: "explicit request native over request shared",
      options: { verbosity: "high", textVerbosity: "low" },
      expected: "low",
    },
    {
      name: "request shared over variant native",
      variant: { textVerbosity: "low" },
      options: { verbosity: "medium" },
      expected: "medium",
    },
    { name: "unconfigured native default", expected: "low" },
  ]) {
    it.live(`keeps ${selection.name} with the real config and verbosity plugins`, () =>
      Effect.acquireUseRelease(
        Effect.sync(() => fixture()),
        (backend) =>
          withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "token" }, () =>
            Effect.gen(function* () {
              const id = Model.ID.make("openai/gpt-5.4")
              backend.state.models = {
                data: [
                  {
                    id,
                    name: "Native verbosity precedence",
                    context_length: 128000,
                    opencode: { ai_sdk_provider: "openai" },
                  },
                ],
              }
              const plugins = yield* Plugin.Service
              yield* VerbosityPlugin.Plugin.effect(yield* PluginHost.make(plugins))
              const host = yield* addPlugin()
              yield* ConfigProviderPlugin.Plugin.effect(host).pipe(
                Effect.provide(
                  Config.testLayer([
                    new Document({
                      type: "document",
                      info: Schema.decodeUnknownSync(Info)({
                        providers: {
                          kilo: {
                            settings: selection.provider ?? {},
                            models: {
                              [id]: {
                                settings: selection.model ?? {},
                                variants: [{ id: "configured", settings: selection.variant ?? {} }],
                              },
                            },
                          },
                        },
                      }),
                    }),
                  ]),
                ),
              )
              expect(KiloPostPlugins).toContain(GatewayOptions.Plugin)
              yield* GatewayOptions.Plugin.effect(host)
              const session = yield* host.session.create({ title: "Native verbosity precedence" })
              const hooks = yield* PluginHooks.Service
              const ref = { providerID: kilo, id, variant: Model.VariantID.make("configured") }
              yield* Effect.gen(function* () {
                const resolver = yield* ModelResolver.Service
                const resolved = yield* resolver.resolve(ref)
                for (const hook of ["context", "compaction", "generate", "title"] as const) {
                  const event = yield* hooks.trigger("session", hook, {
                    sessionID: session.id,
                    agent: Agent.ID.make("code"),
                    model: ref,
                    system: [],
                    messages: [],
                    tools: {},
                    options: { ...selection.options },
                  })
                  expect(event.options.textVerbosity).toBe(selection.expected)
                  const request = yield* compileRequest(
                    LLM.request({
                      model: resolved!.model,
                      prompt: "Hello",
                      providerOptions: event.options,
                    }),
                  )
                  expect(request.body).toMatchObject({ text: { verbosity: selection.expected } })
                }
              }).pipe(Effect.provide(ModelResolver.layer))
            }),
          ),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      ),
    )
  }

  // #15244: a later start does not wait for the network when the exact scope has a stored catalog. The fresh catalog
  // drops the paid frontier model, and for the anonymous scope also the small model.
  for (const scope of [
    {
      name: "personal",
      signedIn: true,
      stored: ["kilo-auto/free", "kilo-auto/frontier", "kilo-auto/small"],
      fresh: ["kilo-auto/free", "kilo-auto/small"],
      default: "kilo-auto/frontier",
    },
    {
      name: "anonymous",
      signedIn: false,
      stored: ["kilo-auto/free", "kilo-auto/small"],
      fresh: ["kilo-auto/free"],
      default: "kilo-auto/free",
    },
  ])
    it.live(
      `starts from the stored ${scope.name} catalog and default, then loads the fresh catalog in the background`,
      () =>
        Effect.acquireUseRelease(
          Effect.sync(() => fixture()),
          (backend) =>
            withEnv({ ...env, KILO_API_URL: backend.url }, () =>
              Effect.gen(function* () {
                const credentials = yield* Credential.Service
                if (scope.signedIn)
                  yield* credentials.create({
                    integrationID,
                    label: "a@example.test",
                    value: oauth({ server: backend.url, organizationID: null, email: "a@example.test" }),
                  })
                // First start: no stored catalog, so the activation waits for the fetch and stores the result.
                yield* Effect.scoped(addPlugin())

                // Second start: the Kilo API is slow and its catalog changed.
                backend.state.delay = 300
                const catalog = backend.state.models as { data: { id: string }[] }
                backend.state.models = {
                  data: catalog.data.filter(
                    (model) => model.id !== "kilo-auto/frontier" && (scope.signedIn || model.id !== "kilo-auto/small"),
                  ),
                }
                const requests = backend.requests.length
                yield* addPlugin()
                const models = yield* Model.Service
                const providers = yield* Provider.Service
                const kiloModels = Effect.map(models.available(), (list) =>
                  list.filter((item) => item.providerID === kilo).map((item) => String(item.id)),
                )
                // The activation returned with the stored catalog and default, before the fetch answered.
                expect(yield* kiloModels).toEqual(scope.stored)
                expect(yield* models.default()).toMatchObject({ providerID: kilo, id: Model.ID.make(scope.default) })
                expect((yield* providers.get(kilo))?.settings?.baseURL).toBe(`${backend.url}/api/gateway/v1`)

                // The fresh catalog arrives in the background and replaces it.
                expect(yield* eventually(kiloModels, (list) => list.length === scope.fresh.length)).toEqual(scope.fresh)
                const fetched = backend.requests.slice(requests).filter((request) => request.path.endsWith("/models"))
                expect(fetched).toHaveLength(1)
              }),
            ),
          (backend) => Effect.sync(() => backend[Symbol.dispose]()),
        ),
    )

  it.live("keeps the stored default with the stored catalog when the Kilo API is down", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID,
              label: "a@example.test",
              value: oauth({ server: backend.url, organizationID: null, email: "a@example.test" }),
            })
            // The stored default differs from the static fallback that `KiloDefaults.get` answers on failure.
            backend.state.defaults = { defaultModel: "kilo-auto/small", defaultFreeModel: "kilo-auto/free" }
            yield* addPlugin()
            const models = yield* Model.Service
            expect(yield* models.default()).toMatchObject({ providerID: kilo, id: Model.ID.make("kilo-auto/small") })

            backend.state.modelsStatus = 503
            backend.state.defaultsStatus = 503
            const rpc = yield* Rpc.Service
            yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: null })
            expect(yield* models.default()).toMatchObject({ providerID: kilo, id: Model.ID.make("kilo-auto/small") })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("waits for the team catalog and never starts a team from a stored personal catalog", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            const personal = yield* credentials.create({
              integrationID,
              label: "a@example.test",
              value: oauth({ server: backend.url, organizationID: null, email: "a@example.test" }),
            })
            // The personal start stores a catalog for this token.
            const host = yield* Effect.scoped(addPlugin())
            yield* host.storage.set(`organization:${personal.id}`, { organizationID: "selected" })

            // The team start with the same token waits for the team catalog.
            backend.state.delay = 100
            yield* addPlugin()
            const models = yield* Model.Service
            expect(
              (yield* models.available()).filter((item) => item.providerID === kilo).map((item) => item.id),
            ).toEqual([Model.ID.make("anthropic/claude-sonnet-4.6"), Model.ID.make("kilo-auto/small")])
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("gives KILO_API_KEY and KILO_ORG_ID precedence over a stored credential like v1", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "env-token", KILO_ORG_ID: "selected" }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID,
              label: "stored",
              value: oauth({ server: "https://staging.kilo.test/", organizationID: "first", email: "a@example.test" }),
            })
            const host = yield* addPlugin()
            const provider = yield* (yield* Provider.Service).get(kilo)
            expect(provider?.headers).toEqual(headers("selected"))
            expect(provider?.settings?.apiKey).toBe("env-token")
            const session = yield* host.session.create({ title: "scope" })
            const hooks = yield* PluginHooks.Service
            const model = { providerID: kilo, id: Model.ID.make("kilo-auto/small") }
            const common = { sessionID: session.id, agent: Agent.ID.make("code"), model, kind: "primary" as const }
            expect(
              (yield* hooks.trigger("session", "model.request", {
                ...common,
                baseURL: "https://model-override.test",
                headers: {},
              })).baseURL,
            ).toBe(`${backend.url}/api/gateway/v1`)
            const request = yield* hooks.trigger("session", "http.request", {
              ...common,
              request: new Request(`${backend.url}/api/gateway/v1/messages`, {
                method: "POST",
                headers: { authorization: "Bearer saved-token", "x-api-key": "saved-token" },
                body: "{}",
              }),
            })
            expect(request.request.headers.get("authorization")).toBe("Bearer env-token")
            expect(request.request.headers.get("x-api-key")).toBeNull()
            expect(request.request.headers.get("x-kilocode-organizationid")).toBe("selected")
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("uses config-only auth and private endpoint for the catalog, profile and request scope", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv(env, () =>
          Effect.gen(function* () {
            const config = yield* Config.Test
            yield* config.setEntries([
              new Document({
                type: "document",
                info: Schema.decodeUnknownSync(Info)({
                  providers: {
                    kilo: {
                      settings: {
                        apiKey: "lower-priority-api-key",
                        kilocodeToken: "config-token",
                        baseURL: backend.url,
                        kilocodeOrganizationId: "first",
                      },
                      models: { "kilo-auto/small": { settings: { baseURL: "https://model-override.test" } } },
                    },
                  },
                }),
              }),
            ])
            const host = yield* addPlugin()
            yield* ConfigProviderPlugin.Plugin.effect(host)
            const rpc = yield* Rpc.Service
            expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toEqual({
              authenticated: true,
              server: backend.url,
              organizationID: "first",
            })
            expect(yield* rpc.call("kilocode.gateway", "profile", {})).toMatchObject({ organizationID: "first" })
            expect(
              backend.requests
                .filter((request) => request.path.includes("models"))
                .every((request) => request.authorization === "Bearer config-token"),
            ).toBe(true)
            const hooks = yield* PluginHooks.Service
            const session = yield* host.session.create({ title: "config" })
            const model = { providerID: kilo, id: Model.ID.make("kilo-auto/small") }
            expect(
              (yield* hooks.trigger("session", "model.request", {
                sessionID: session.id,
                agent: Agent.ID.make("code"),
                model,
                kind: "primary",
                baseURL: "https://model-override.test",
                headers: {},
              })).baseURL,
            ).toBe(`${backend.url}/api/openrouter`)
            yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: null })
            expect(yield* rpc.call("kilocode.gateway", "profile", {})).toMatchObject({ organizationID: null })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("keeps saved auth above config and replaces saved auth with KILO_AUTH_CONTENT", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            yield* (yield* Credential.Service).create({
              integrationID,
              label: "saved",
              value: Credential.Key.make({ type: "key", key: "saved-token" }),
            })
            yield* (yield* Config.Test).setEntries([
              new Document({
                type: "document",
                info: Schema.decodeUnknownSync(Info)({ providers: { kilo: { settings: { apiKey: "config-token" } } } }),
              }),
            ])
            for (const [content, expected] of [
              [undefined, "saved-token"],
              [
                JSON.stringify({ kilo: { type: "oauth", access: "injected-token", accountId: "first" } }),
                "injected-token",
              ],
              ["{}", "config-token"],
            ] as const) {
              yield* withEnv({ KILO_AUTH_CONTENT: content }, () =>
                Effect.scoped(
                  Effect.gen(function* () {
                    yield* addPlugin()
                    yield* (yield* Rpc.Service).call("kilocode.gateway", "profile", {})
                    expect(backend.requests.at(-1)?.authorization).toBe(`Bearer ${expected}`)
                  }),
                ),
              )
            }
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  for (const scenario of [
    { name: "empty saved OAuth organization", saved: "", configured: "selected", expected: "selected" },
    { name: "explicit saved Personal", saved: null, configured: "selected", expected: null },
    { name: "empty configured organization", saved: "", configured: "", expected: null },
    { name: "empty organization with a scoped URL", saved: "", configured: "", expected: "selected", scoped: true },
  ]) {
    it.live(`resolves ${scenario.name} without changing an explicit Personal choice`, () =>
      Effect.gen(function* () {
        const backend = yield* Effect.acquireRelease(
          Effect.sync(() => fixture()),
          (backend) => Effect.sync(() => backend[Symbol.dispose]()),
        )
        yield* withEnv({ ...env, KILO_API_URL: backend.url }, () => Effect.gen(function* () {
          const credentials = yield* Credential.Service
          yield* credentials.create({
            integrationID,
            label: "saved",
            value: oauth({ server: backend.url, organizationID: scenario.saved }),
          })
          const config = yield* Config.Test
          yield* config.setEntries([new Document({
            type: "document",
            info: Schema.decodeUnknownSync(Info)({ providers: { kilo: { settings: {
              kilocodeOrganizationId: scenario.configured,
              ...(scenario.scoped ? { baseURL: `${backend.url}/api/organizations/selected` } : {}),
            } } } }),
          })])
          const host = yield* addPlugin()
          const rpc = yield* Rpc.Service
          expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toMatchObject({
            authenticated: true,
            organizationID: scenario.expected,
          })
          expect(backend.requests.filter((request) => request.path.endsWith("/models"))).toEqual([{
            method: "GET",
            path: scenario.expected
              ? scenario.scoped ? "/api/organizations/selected/models" : "/api/gateway/v1/organizations/selected/models"
              : "/api/gateway/v1/models",
            authorization: "Bearer token",
            ...(scenario.expected ? { organizationID: scenario.expected } : {}),
          }])
          if (scenario.expected && !scenario.scoped) {
            yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: null })
            yield* host.provider.reload()
            expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toMatchObject({ organizationID: null })
          }
        }))
      }),
    )
  }

  for (const source of ["env", "config"] as const) {
    it.live(`fails closed for a ${source} organization without a token`, () =>
      Effect.gen(function* () {
        const backend = yield* Effect.acquireRelease(
          Effect.sync(() => fixture()),
          (backend) => Effect.sync(() => backend[Symbol.dispose]()),
        )
        yield* withEnv({ ...env, KILO_API_URL: backend.url, KILO_ORG_ID: source === "env" ? "selected" : undefined }, () => Effect.gen(function* () {
          if (source === "config") {
            const config = yield* Config.Test
            yield* config.setEntries([new Document({ type: "document", info: Schema.decodeUnknownSync(Info)({
              providers: { kilo: { settings: { kilocodeOrganizationId: "selected" } } },
            }) })])
          }
          const host = yield* addPlugin()
          const rpc = yield* Rpc.Service
          const providers = yield* Provider.Service
          expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toMatchObject({ authenticated: false, organizationID: "selected" })
          expect((yield* providers.available()).some((provider) => provider.id === kilo)).toBe(false)
          expect(yield* rpc.client(KiloGatewayRpc.Definition).models({}).pipe(Effect.flip)).toMatchObject({ type: "failed", data: { kind: "unauthorized" } })
          expect(yield* rpc.client(KiloGatewayRpc.Definition)["models.images"]({}).pipe(Effect.flip)).toMatchObject({ type: "unauthorized" })
          const session = yield* host.session.create({ title: "no token" })
          const hooks = yield* PluginHooks.Service
          expect(Exit.isFailure(yield* hooks.trigger("session", "http.request", {
            sessionID: session.id,
            agent: Agent.ID.make("code"),
            model: { providerID: kilo, id: Model.ID.make("kilo-auto/free") },
            kind: "primary",
            request: new Request(`${backend.url}/api/gateway/v1/chat/completions`),
          }).pipe(Effect.exit))).toBe(true)
          expect(backend.requests).toEqual([])
        }))
      }),
    )
  }

  for (const source of ["oauth", "key", "config-token", "config-key"] as const) {
    it.live(`sends an explicit empty ${source} token through the native model request without lower credentials`, () =>
      Effect.gen(function* () {
        const backend = yield* Effect.acquireRelease(
          Effect.sync(() => fixture()),
          (backend) => Effect.sync(() => backend[Symbol.dispose]()),
        )
        const sent: Array<{ path: string; authorization: string | null; apiKey: string | null; body: string }> = []
        backend.state.models = { data: [
          { id: "kilo-auto/free", name: "Free", context_length: 128000, isFree: true },
          { id: "anthropic/free", name: "Free Anthropic", context_length: 128000, isFree: true, opencode: { ai_sdk_provider: "anthropic" } },
          { id: "paid/model", name: "Paid", context_length: 128000, isFree: false },
        ] }
        const inference = yield* Effect.acquireRelease(
          Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
            const path = new URL(request.url).pathname
            if (request.method === "GET") return fetch(new URL(path, backend.url), request)
            sent.push({ path, authorization: request.headers.get("authorization"), apiKey: request.headers.get("x-api-key"), body: await request.text() })
            if (path.endsWith("/messages")) return new Response([
              { type: "message_start", message: { id: "message-empty-token", type: "message", role: "assistant", model: "anthropic/free", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
              { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
              { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } },
              { type: "content_block_stop", index: 0 },
              { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
              { type: "message_stop" },
            ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } })
            return new Response(`data: ${JSON.stringify({
              id: "completion-empty-token",
              object: "chat.completion.chunk",
              created: 0,
              model: "kilo-auto/free",
              choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
          } })),
          (server) => Effect.sync(() => server.stop(true)),
        )
        yield* withEnv({ ...env, KILO_API_URL: backend.url, KILO_AI_GATEWAY_URL: `${inference.url.origin}/api/v1` }, () => Effect.gen(function* () {
          const credentials = yield* Credential.Service
          if (source === "oauth" || source === "key") yield* credentials.create({
            integrationID,
            label: "empty",
            value: source === "oauth"
              ? Credential.OAuth.make({ type: "oauth", methodID, access: "", refresh: "", expires: 0, metadata: { server: backend.url } })
              : Credential.Key.make({ type: "key", key: "" }),
          })
          const config = yield* Config.Test
          yield* config.setEntries([new Document({ type: "document", info: Schema.decodeUnknownSync(Info)({
            providers: { kilo: { settings: {
              apiKey: source === "config-key" ? "" : "lower-key",
              ...(source !== "config-key" ? { kilocodeToken: source === "config-token" ? "" : "lower-token" } : {}),
            } } },
          }) })])
          const host = yield* addPlugin()
          yield* ConfigProviderPlugin.Plugin.effect(host)
          const providers = yield* Provider.Service
          expect((yield* providers.get(kilo))?.settings).toMatchObject({
            apiKey: source === "config-key" ? "" : "lower-key",
            kiloEmptyToken: true,
          })
          const rpc = yield* Rpc.Service
          expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toMatchObject({ authenticated: false, organizationID: null })
          expect(yield* rpc.call("kilocode.gateway", "models", {})).toHaveLength(2)
          const resolver = yield* ModelResolver.Service.pipe(Effect.provide(KiloGatewayModel.resolverLayer(ModelResolver.layer)))
          const session = yield* host.session.create({ title: "empty token" })
          const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer.pipe(
            Layer.provide(SessionModelTransport.layer.pipe(Layer.provide(WebSocketConstructor.layer))),
          )))
          const llm = yield* LLMClient.Service.pipe(Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer))))
          for (const id of ["kilo-auto/free", "anthropic/free"]) {
            const resolved = yield* resolver.resolve(Model.Ref.make({ providerID: kilo, id: Model.ID.make(id) }))
            if (!resolved) throw new Error("Missing empty-token model")
            const prepared = yield* requests.primary({ session, agent: Agent.ID.make("code"), model: resolved, system: [], messages: [] })
            yield* llm.generate(prepared.request, prepared.options)
            yield* llm.generate(LLM.request({ model: resolved.model, prompt: "Stateless empty token" }))
          }
          expect(sent.map((request) => ({ path: request.path, authorization: request.authorization, apiKey: request.apiKey }))).toEqual([
            { path: "/api/v1/chat/completions", authorization: "Bearer", apiKey: null },
            { path: "/api/v1/chat/completions", authorization: "Bearer", apiKey: null },
            { path: "/api/v1/messages", authorization: "Bearer", apiKey: null },
            { path: "/api/v1/messages", authorization: "Bearer", apiKey: null },
          ])
          expect(sent.every((request) => !request.body.includes("kiloEmptyToken"))).toBe(true)
          expect(backend.requests.every((request) => request.authorization === null)).toBe(true)
          const stored = yield* credentials.list(integrationID)
          expect(stored).toHaveLength(source === "oauth" || source === "key" ? 1 : 0)
          if (source === "oauth" || source === "key") {
            expect(stored[0]?.value).toMatchObject(source === "oauth" ? { access: "" } : { key: "" })
          }
          if (source !== "key") return
          yield* credentials.create({ integrationID, label: "usable OAuth", value: oauth({ server: backend.url }) })
          yield* host.provider.reload()
          expect((yield* providers.get(kilo))?.settings?.kiloEmptyToken).toBe(false)
          const modelService = yield* Model.Service
          yield* eventually(modelService.get(kilo, Model.ID.make("kilo-auto/free")), Boolean)
          const restored = yield* resolver.resolve(Model.Ref.make({ providerID: kilo, id: Model.ID.make("kilo-auto/free") }))
          if (!restored) throw new Error("Missing restored OAuth model")
          yield* llm.generate(LLM.request({ model: restored.model, prompt: "Restored OAuth" }))
          expect(sent.at(-1)?.authorization).toBe("Bearer token")
          expect(sent.at(-1)?.body.includes("kiloEmptyToken")).toBe(false)
        }))
      }),
    )
  }

  it.live("sends anonymous fallback requests without erasing the retained credential identity", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            backend.state.authenticatedModelsStatus = 401
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID,
              label: "rejected",
              value: oauth({ server: backend.url, organizationID: null }),
            })
            const host = yield* addPlugin()
            const rpc = yield* Rpc.Service
            const providers = yield* Provider.Service
            expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toMatchObject({ authenticated: true })
            expect((yield* providers.get(kilo))?.settings?.apiKey).toBe("anonymous")
            expect(backend.requests.filter((request) => request.path.endsWith("/models")).map((request) => request.authorization))
              .toEqual(["Bearer token", null])
            const session = yield* host.session.create({ title: "anonymous fallback" })
            const hooks = yield* PluginHooks.Service
            const request = yield* hooks.trigger("session", "http.request", {
              sessionID: session.id,
              agent: Agent.ID.make("code"),
              model: { providerID: kilo, id: Model.ID.make("kilo-auto/free") },
              kind: "primary",
              request: new Request(`${backend.url}/api/gateway/v1/chat/completions`, {
                method: "POST",
                headers: { authorization: "Bearer fixture-token", "x-kilocode-organizationid": "stale" },
                body: "{}",
              }),
            })
            expect(request.request.headers.get("authorization")).toBe("Bearer anonymous")
            expect(request.request.headers.get("x-kilocode-organizationid")).toBeNull()
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  for (const flag of [undefined, null])
    it.live(`allows Personal when hasPersonalAccount is ${String(flag)}`, () =>
      Effect.acquireUseRelease(
        Effect.sync(() => fixture()),
        (backend) =>
          withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "personal-token" }, () =>
            Effect.gen(function* () {
              backend.state.profile = {
                user: { email: "personal@example.test" },
                organizations: [],
                ...(flag === null ? { hasPersonalAccount: null } : {}),
              }
              yield* addPlugin()
              const models = yield* Model.Service
              expect((yield* models.available()).some((model) => model.providerID === kilo)).toBe(true)
              const rpc = yield* Rpc.Service
              expect(yield* rpc.call("kilocode.gateway", "profile", {})).toMatchObject({ hasPersonalAccount: true })
              yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: null })
              expect(yield* rpc.call("kilocode.gateway", "profile", {})).toMatchObject({ organizationID: null })
            }),
          ),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      ),
    )

  for (const legacy of [
    {
      name: "team",
      organizationID: "selected",
      input: { KILO_API_KEY: "legacy-token" },
      next: { KILO_API_KEY: "next-token" },
    },
    {
      name: "personal",
      organizationID: null,
      input: { KILO_AUTH_CONTENT: JSON.stringify({ kilo: { type: "api", key: "legacy-token" } }) },
      next: { KILO_AUTH_CONTENT: JSON.stringify({ kilo: { type: "api", key: "next-token" } }) },
    },
  ])
    it.live(`migrates the legacy env ${legacy.name} selection once without reusing it for another account`, () =>
      Effect.acquireUseRelease(
        Effect.sync(() => fixture()),
        (backend) =>
          withEnv({ ...env, KILO_API_URL: backend.url }, () =>
            Effect.gen(function* () {
              const plugin = yield* Plugin.Service
              const host = yield* PluginHost.make(plugin)
              const input = legacy.name === "team"
                ? { KILO_API_KEY: `${backend.url}/api:legacy-token` }
                : legacy.input
              yield* host.storage.set("organization:env", { organizationID: legacy.organizationID })
              const config = yield* Config.Test
              yield* config.setEntries([
                new Document({
                  type: "document",
                  info: Schema.decodeUnknownSync(Info)({
                    providers: { kilo: { settings: { kilocodeOrganizationId: "first" } } },
                  }),
                }),
              ])
              const rpc = yield* Rpc.Service
              yield* withEnv(input, () =>
                Effect.scoped(Effect.gen(function* () {
                  yield* addPlugin()
                  expect(yield* rpc.call("kilocode.gateway", "profile", {})).toMatchObject({
                    organizationID: legacy.organizationID,
                  })
                  expect(yield* host.storage.get("organization:env")).toBeUndefined()
                })),
              )
              yield* withEnv(legacy.next, () =>
                Effect.scoped(Effect.gen(function* () {
                  yield* addPlugin()
                  expect(yield* rpc.call("kilocode.gateway", "profile", {})).toMatchObject({ organizationID: "first" })
                })),
              )
              if (legacy.name === "team") {
                yield* config.setEntries([
                  new Document({
                    type: "document",
                    info: Schema.decodeUnknownSync(Info)({
                      providers: { kilo: { settings: { baseURL: "http://127.0.0.1:1/ignored", kilocodeOrganizationId: "first" } } },
                    }),
                  }),
                ])
              }
              yield* host.storage.set("organization:env", { organizationID: "first" })
              yield* withEnv(input, () =>
                Effect.scoped(Effect.gen(function* () {
                  yield* addPlugin()
                  expect(yield* rpc.call("kilocode.gateway", "profile", {})).toMatchObject({
                    organizationID: legacy.organizationID,
                  })
                  expect(yield* host.storage.get("organization:env")).toBeUndefined()
                })),
              )
            }),
          ),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      ),
    )

  it.live("keeps default and saved-login Gateway routing distinct from an explicit API-root override", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "route-token" }, () =>
          Effect.gen(function* () {
            const config = yield* Config.Test
            const hooks = yield* PluginHooks.Service
            const probe = (baseURL: string) => Effect.scoped(Effect.gen(function* () {
              const host = yield* addPlugin()
              const session = yield* host.session.create({ title: "routing parity" })
              expect((yield* hooks.trigger("session", "model.request", {
                sessionID: session.id,
                agent: Agent.ID.make("code"),
                model: { providerID: kilo, id: Model.ID.make("kilo-auto/small") },
                kind: "primary",
                headers: {},
              })).baseURL).toBe(baseURL)
            }))
            yield* probe(`${backend.url}/api/gateway/v1`)
            yield* config.setEntries([new Document({
              type: "document",
              info: Schema.decodeUnknownSync(Info)({ providers: { kilo: { settings: { baseURL: backend.url } } } }),
            })])
            yield* probe(`${backend.url}/api/openrouter`)
            yield* config.setEntries([])
            const credentials = yield* Credential.Service
            yield* credentials.create({ integrationID, label: "login", value: oauth({ server: backend.url, organizationID: null }) })
            yield* withEnv({ KILO_API_KEY: undefined }, () => probe(`${backend.url}/api/gateway/v1`))
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("uses the API app root for account and device calls while preserving the inference base", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv(env, () =>
          Effect.gen(function* () {
            const config = yield* Config.Test
            yield* config.setEntries([new Document({
              type: "document",
              info: Schema.decodeUnknownSync(Info)({ providers: { kilo: { settings: {
                apiKey: "path-token",
                baseURL: `${backend.url}/api/gateway`,
                kilocodeOrganizationId: "first",
              } } } }),
            })])
            const host = yield* addPlugin()
            yield* ConfigProviderPlugin.Plugin.effect(host)
            const rpc = yield* Rpc.Service
            expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toMatchObject({ server: backend.url })
            for (const method of ["profile", "balance", "kiloPass", "byok", "modes", "notifications"])
              yield* rpc.call("kilocode.gateway", method, {})
            backend.state.pending = 100
            const integrations = yield* Integration.Service
            const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
            yield* integrations.oauth.cancel({ integrationID, attemptID: attempt.attemptID })
            const session = yield* host.session.create({ title: "API root" })
            const hooks = yield* PluginHooks.Service
            expect((yield* hooks.trigger("session", "model.request", {
              sessionID: session.id,
              agent: Agent.ID.make("code"),
              model: { providerID: kilo, id: Model.ID.make("kilo-auto/small") },
              kind: "primary",
              headers: {},
            })).baseURL).toBe(`${backend.url}/api/openrouter`)
            expect(backend.requests.some((request) => request.path === "/api/device-auth/codes")).toBe(true)
            expect(backend.requests.every((request) => !request.path.includes("/api/gateway/api/"))).toBe(true)
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("fails closed without requesting a personal catalog when an unscoped account profile is unavailable", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "unknown-scope" }, () =>
          Effect.gen(function* () {
            backend.state.profileStatus = 503
            yield* addPlugin()
            const models = yield* Model.Service
            expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual([])
            expect(backend.requests.some((request) => request.path.endsWith("/models"))).toBe(false)
            const rpc = yield* Rpc.Service
            expect(yield* rpc.call("kilocode.gateway", "models", {}).pipe(Effect.flip)).toMatchObject({ type: "failed" })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("rejects unknown teams before persisting and reports a valid selected team's catalog outage", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv(env, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({ integrationID, label: "member", value: oauth({ server: backend.url, organizationID: "first" }) })
            const host = yield* addPlugin()
            const rpc = yield* Rpc.Service
            const before = yield* host.storage.scan({ prefix: "organization:" })
            for (const organizationID of ["unknown", ""])
              expect(yield* rpc.call("kilocode.gateway", "organization.set", { organizationID }).pipe(Effect.flip))
                .toMatchObject({ type: "failed" })
            expect(yield* host.storage.scan({ prefix: "organization:" })).toEqual(before)
            expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toMatchObject({ organizationID: "first" })
            backend.state.teamModelsStatus = 503
            expect(yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: "selected" }).pipe(Effect.flip))
              .toMatchObject({ type: "failed" })
            expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toMatchObject({ organizationID: "selected" })
            const models = yield* Model.Service
            expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual([])
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("fails closed on token organization conflicts even when the profile belongs to both teams", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv(
          { ...env, KILO_API_KEY: `${backend.url}/api/organizations/first:secret`, KILO_ORG_ID: "selected" },
          () =>
            Effect.gen(function* () {
              const plugin = yield* Plugin.Service
              const host = yield* PluginHost.make(plugin)
              yield* host.storage.set("organization:env", { organizationID: "selected" })
              yield* addPlugin()
              expect((yield* (yield* Model.Service).available()).filter((model) => model.providerID === kilo)).toEqual(
                [],
              )
              expect(backend.requests).toEqual([])
              const rpc = yield* Rpc.Service
              expect(
                yield* rpc.call("kilocode.gateway", "profile", {}).pipe(Effect.flip),
              ).toMatchObject({
                type: "unauthorized",
              })
              expect(
                yield* rpc
                  .call("kilocode.gateway", "organization.set", {
                    organizationID: "selected",
                  })
                  .pipe(Effect.flip),
              ).toMatchObject({ type: "failed" })
              expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toMatchObject({ authenticated: false, organizationID: null })
              for (const method of ["models.images", "models.transcriptions", "models.embeddings", "autocomplete.fimTarget", "autocomplete.editTarget"])
                expect(yield* rpc.call("kilocode.gateway", method, {}).pipe(Effect.flip)).toMatchObject({ type: "unauthorized" })
              expect(yield* rpc.call("kilocode.gateway", "autocomplete.fimTarget", { provider: "mistral", model: "codestral-2508" }))
                .toMatchObject({ provider: "mistral" })
              expect(yield* rpc.call("kilocode.gateway", "autocomplete.editTarget", { provider: "inception", model: "mercury-next-edit" }))
                .toMatchObject({ provider: "inception" })
              expect(backend.requests).toEqual([])
              expect(yield* host.storage.get("organization:env")).toEqual({ organizationID: "selected" })
            }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("selects the default team for an ordinary key on a team-only account and rejects Personal", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            backend.state.profile = {
              user: { email: "team@example.test" },
              organizations: [{ id: "first", name: "First" }],
              hasPersonalAccount: false,
              selectedOrganizationId: "first",
            }
            yield* (yield* Credential.Service).create({
              integrationID,
              label: "team-only-key",
              value: Credential.Key.make({ type: "key", key: "team-key" }),
            })
            yield* addPlugin()
            const rpc = yield* Rpc.Service
            expect(yield* rpc.call("kilocode.gateway", "profile", {})).toMatchObject({ organizationID: "first" })
            expect(
              backend.requests.filter((request) => request.path.includes("models")).map((request) => request.path),
            ).toEqual(["/api/gateway/v1/organizations/first/models"])
            expect(
              yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: null }).pipe(Effect.flip),
            ).toMatchObject({ type: "failed" })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("reads the profile and stores the team choice per connection, as v1 does after login", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv(env, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID,
              label: "a@example.test",
              value: oauth({ server: backend.url, organizationID: "selected", email: "a@example.test" }),
            })
            const host = yield* addPlugin()
            const rpc = yield* Rpc.Service
            const providers = yield* Provider.Service
            expect(yield* rpc.call("kilocode.gateway", "profile", {})).toEqual({
              email: "profile@example.test",
              name: "Fixture",
              organizations: [
                { id: "first", name: "First", role: "member" },
                { id: "selected", name: "Selected", role: "owner" },
              ],
              hasPersonalAccount: true,
              organizationID: "selected",
            })
            expect(backend.requests.some((req) => req.path === "/api/profile" && req.authorization === "Bearer token")).toBe(
              true,
            )

            yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: "first" })
            expect((yield* providers.get(kilo))?.headers).toEqual(headers("first"))
            expect(yield* rpc.call("kilocode.gateway", "profile", {})).toMatchObject({ organizationID: "first" })
            yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: null })
            expect((yield* providers.get(kilo))?.headers).toEqual(headers())

            // Global bus broadcast reloads when another location publishes `rpc.kilocode.gateway.organization`.
            yield* host.storage.set(`organization:${(yield* credentials.list(integrationID))[0]?.id}`, {
              organizationID: "selected",
            })
            yield* (yield* Bus.Service).publish(
              Bus.ephemeral({
                type: "rpc.kilocode.gateway.organization",
                schema: {},
              }),
              {},
              { global: true },
            )
            expect(
              (yield* eventually(providers.get(kilo), (provider) => provider?.headers?.["X-KILOCODE-ORGANIZATIONID"] === "selected"))
                ?.headers,
            ).toEqual(headers("selected"))

            // A new login is a new connection, so its own default team applies again.
            yield* credentials.create({
              integrationID,
              label: "b@example.test",
              value: oauth({ server: backend.url, organizationID: "selected", email: "b@example.test" }),
            })
            expect(
              (yield* eventually(
                providers.get(kilo),
                (provider) => provider?.headers?.["X-KILOCODE-ORGANIZATIONID"] === "selected",
              ))?.headers,
            ).toEqual(headers("selected"))
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("rejects account calls when signed out", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const rpc = yield* Rpc.Service
            expect(yield* rpc.call("kilocode.gateway", "profile", {}).pipe(Effect.flip)).toMatchObject({
              type: "unauthorized",
            })
            expect(
              yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: "team" }).pipe(Effect.flip),
            ).toMatchObject({ type: "unauthorized" })
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live(
    "injects per-request headers, sanitizes request bodies, rewrites Gateway errors, and records routedModelID",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => fixture()),
        (backend) =>
          withEnv(
            {
              ...env,
              KILO_API_URL: backend.url,
              KILO_API_KEY: "env-token",
              KILO_ORG_ID: "selected",
              KILO_MACHINE_ID: "mach-test",
              KILO_DATA_COLLECTION: "deny",
            },
            () =>
              Effect.gen(function* () {
                const host = yield* addPlugin()
                const hooks = yield* PluginHooks.Service
                const rpc = yield* Rpc.Service
                const parent = yield* host.session.create({ title: "parent" })
                const child = yield* host.session.create({ title: "child", parentID: parent.id })
                const modelRef = {
                  providerID: kilo,
                  id: Model.ID.make("kilo-auto/frontier"),
                }

                const modelEvt = yield* hooks.trigger("session", "model.request", {
                  sessionID: child.id,
                  agent: Agent.ID.make("code"),
                  model: modelRef,
                  kind: "primary",
                  headers: {},
                })
                expect(modelEvt.headers).toMatchObject({
                  "HTTP-Referer": "https://kilocode.ai",
                  "X-Title": "Kilo Code",
                  "X-KILOCODE-ORGANIZATIONID": "selected",
                  "X-KILOCODE-TASKID": child.id,
                  "X-KILOCODE-PARENT-TASKID": parent.id,
                  "X-KILOCODE-MACHINEID": "mach-test",
                  "x-kilocode-mode": "code",
                  "User-Agent": "opencode-kilo-provider/unknown",
                })

                const httpReq = yield* hooks.trigger("session", "http.request", {
                  sessionID: child.id,
                  agent: Agent.ID.make("code"),
                  model: modelRef,
                  kind: "primary",
                  request: new Request(`${backend.url}/api/gateway/responses`, {
                    method: "POST",
                    headers: { "content-type": "application/json", "x-api-key": "env-token" },
                    body: JSON.stringify({
                      model: "openai/gpt-5.4",
                      server: backend.url,
                      organizationID: "selected",
                      input: [
                        { type: "item_reference", id: "item_1" },
                        { type: "message", id: "msg_1", role: "user", content: "hello" },
                      ],
                    }),
                  }),
                })
                expect(httpReq.request.headers.get("authorization")).toBe("Bearer env-token")
                expect(httpReq.request.headers.get("x-api-key")).toBeNull()
                expect(yield* Effect.promise(() => httpReq.request.json())).toEqual({
                  model: "openai/gpt-5.4",
                  input: [{ type: "message", role: "user", content: "hello" }],
                  provider: { data_collection: "deny" },
                })

                const errorRes = yield* hooks.trigger("session", "http.response", {
                  sessionID: child.id,
                  agent: Agent.ID.make("code"),
                  model: modelRef,
                  kind: "primary",
                  request: httpReq.request,
                  response: Response.json(
                    {
                      error: {
                        title: "Low balance",
                        message: "Balance is depleted.",
                        balance: 0,
                        buyCreditsUrl: "https://app.kilo.ai/billing",
                      },
                      error_type: "usage_limit_exceeded",
                    },
                    { status: 402 },
                  ),
                })
                expect(yield* Effect.promise(() => errorRes.response.json())).toMatchObject({
                  error: {
                    code: "usage_limit_exceeded",
                    message:
                      "Low balance: Balance is depleted. (Balance: $0.00) Buy credits at https://app.kilo.ai/billing",
                  },
                })

                const sseBody = [
                  `data: ${JSON.stringify({
                    model: "anthropic/claude-sonnet-4.6",
                    choices: [{ delta: { content: "PONG" }, finish_reason: "stop" }],
                    usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
                  })}`,
                  "data: [DONE]",
                  "",
                ].join("\n")
                const streamRes = yield* hooks.trigger("session", "http.response", {
                  sessionID: Session.ID.make(child.id),
                  agent: Agent.ID.make("code"),
                  model: modelRef,
                  kind: "primary",
                  request: httpReq.request,
                  response: new Response(sseBody, {
                    status: 200,
                    headers: { "content-type": "text/event-stream", "x-vercel-id": "iad1::abc" },
                  }),
                })
                const streamText = yield* Effect.promise(() => streamRes.response.text())
                expect(streamText).toContain('"routedModelID":"anthropic/claude-sonnet-4.6"')
                expect(
                  yield* rpc.call("kilocode.gateway", "session.metadata", { sessionID: child.id }),
                ).toEqual({
                  routedModelID: "anthropic/claude-sonnet-4.6",
                  vercelID: "iad1::abc",
                })
              }),
          ),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      ),
  )

  it.live(
    "serves enterprise account, balance, Kilo Pass, BYOK, coding plans, modes, notifications, media and embedding models, and FIM/edit targets over RPC",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => fixture()),
        (backend) =>
          withEnv(
            {
              ...env,
              KILO_API_URL: backend.url,
              KILO_API_KEY: "env-token",
              KILO_ORG_ID: "selected",
            },
            () =>
              Effect.gen(function* () {
                yield* addPlugin()
                const rpc = yield* Rpc.Service
                expect(yield* rpc.call("kilocode.gateway", "authStatus", {})).toEqual({
                  authenticated: true,
                  organizationID: "selected",
                  server: backend.url,
                })
                expect(yield* rpc.call("kilocode.gateway", "balance", {})).toEqual({
                  balance: 42.5,
                  isDepleted: false,
                })
                expect(yield* rpc.call("kilocode.gateway", "kiloPass", {})).toEqual({
                  currentPeriodBaseCreditsUsd: 50,
                  currentPeriodUsageUsd: 12.25,
                  currentPeriodBonusCreditsUsd: 5,
                  nextBillingAt: "2026-11-01T00:00:00Z",
                })
                expect(yield* rpc.call("kilocode.gateway", "byok", {})).toEqual([
                  { id: "byok-1", provider_id: "anthropic", management_source: "user", is_enabled: true },
                ])
                expect(yield* rpc.call("kilocode.gateway", "codingPlans", {})).toEqual([
                  {
                    id: "sub-1",
                    planId: "plan-pro",
                    planName: "Kilo Coding Plan Pro",
                    providerName: "Anthropic",
                    providerId: "anthropic",
                    canQueryUsage: true,
                    hasInstalledByokKey: true,
                    status: "active",
                    cancelAtPeriodEnd: false,
                  },
                ])
                expect(
                  yield* rpc.call("kilocode.gateway", "codingPlanUsage", { subscriptionID: "sub-1" }),
                ).toMatchObject({
                  schemaVersion: 1,
                  subscription: { id: "sub-1" },
                })
                expect(yield* rpc.call("kilocode.gateway", "modes", {})).toMatchObject([
                  { id: "mode-1", slug: "security-reviewer", name: "Security Reviewer" },
                ])
                expect(yield* rpc.call("kilocode.gateway", "notifications", {})).toEqual([
                  {
                    id: "notif-1",
                    title: "Kilo v2 Available",
                    message: "Try the new v2 CLI.",
                    action: { actionText: "Learn more", actionURL: "https://kilo.ai" },
                    showIn: ["cli"],
                  },
                ])
                expect(yield* rpc.call("kilocode.gateway", "models.images", {})).toEqual([
                  {
                    id: "google/gemini-2.5-flash-image",
                    name: "Gemini 2.5 Flash Image",
                    description: "Image generation model",
                  },
                ])
                expect(yield* rpc.call("kilocode.gateway", "models.transcriptions", {})).toEqual([
                  { id: "openai/gpt-4o-mini-transcribe", name: "GPT-4o Mini Transcribe" },
                ])
                expect(yield* rpc.call("kilocode.gateway", "models.embeddings", {})).toMatchObject({
                  defaultModel: "mistralai/mistral-embed-2312",
                  models: [{ id: "mistralai/codestral-embed-2505", dimension: 1536, note: "code" }, { dimension: 1024 }],
                })
                expect(
                  yield* rpc.call("kilocode.gateway", "autocomplete.fimTarget", {
                    provider: "kilo",
                    model: "mistralai/codestral-2508",
                  }),
                ).toEqual({
                  provider: "kilo",
                  model: "mistralai/codestral-2508",
                  url: `${backend.url}/api/gateway/v1/fim/completions`,
                })
                expect(
                  yield* rpc.call("kilocode.gateway", "autocomplete.editTarget", {
                    provider: "kilo",
                    model: "inception/mercury-next-edit",
                  }),
                ).toEqual({
                  provider: "kilo",
                  model: "inception/mercury-edit-2",
                  url: `${backend.url}/api/gateway/v1/edit/completions`,
                })
              }),
          ),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      ),
  )
})
