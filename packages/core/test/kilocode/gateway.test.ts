import { describe, expect } from "bun:test"
import { KiloErrors } from "@kilocode/gateway-core"
import { fixture } from "@kilocode/gateway-core/testing"
import { isRetryable } from "@opencode/ai"
import { httpFailure } from "@opencode/ai/route/executor"
import { Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { KiloGatewayPlugin } from "@opencode/core/kilocode/gateway"
import { KiloGatewayRpc } from "@opencode/core/kilocode/gateway-rpc"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { KiloPlugin } from "@opencode/core/plugin/provider/kilo"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

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
  yield* KiloGatewayPlugin.effect(host)
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
  it.effect("is not in the upstream built-in provider list; the Kilo host registers it", () =>
    Effect.sync(() => {
      expect(ProviderPlugins.map((item) => item.id)).not.toContain(KiloGatewayPlugin.id)
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
              (yield* eventually(providers.get(kilo), (provider) => !provider?.headers?.["X-KILOCODE-ORGANIZATIONID"]))
                ?.headers,
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
            yield* rpc.call("kilocode.gateway", "organization.set", { organizationID: "selected" })
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

  // #15244: a later start does not wait for the network when the exact scope has a stored catalog.
  it.live("starts from the stored personal catalog and default, then loads the fresh catalog in the background", () =>
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
            // First start: no stored catalog, so the activation waits for the fetch and stores the result.
            yield* Effect.scoped(addPlugin())

            // Second start: the Kilo API is slow and its catalog changed.
            backend.state.delay = 300
            const catalog = backend.state.models as { data: unknown[] }
            backend.state.models = { data: catalog.data.slice(0, 2) }
            const requests = backend.requests.length
            yield* addPlugin()
            const models = yield* Model.Service
            const providers = yield* Provider.Service
            const kiloModels = Effect.map(models.available(), (list) =>
              list.filter((item) => item.providerID === kilo).map((item) => item.id),
            )
            // The activation returned with the stored catalog and default, before the fetch answered.
            expect(yield* kiloModels).toEqual([
              Model.ID.make("kilo-auto/free"),
              Model.ID.make("kilo-auto/frontier"),
              Model.ID.make("kilo-auto/small"),
            ])
            expect(yield* models.default()).toMatchObject({ providerID: kilo, id: Model.ID.make("kilo-auto/frontier") })
            expect((yield* providers.get(kilo))?.settings?.baseURL).toBe(`${backend.url}/api/gateway/v1`)

            // The fresh catalog arrives in the background and replaces it.
            expect(yield* eventually(kiloModels, (list) => list.length === 2)).toEqual([
              Model.ID.make("kilo-auto/free"),
              Model.ID.make("kilo-auto/frontier"),
            ])
            const fetched = backend.requests.slice(requests).filter((request) => request.path.endsWith("/models"))
            expect(fetched).toHaveLength(1)
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
            yield* addPlugin()
            const provider = yield* (yield* Provider.Service).get(kilo)
            expect(provider?.headers).toEqual(headers("selected"))
            expect(provider?.settings?.apiKey).toBe("env-token")
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
              (yield* eventually(
                providers.get(kilo),
                (provider) => provider?.headers?.["X-KILOCODE-ORGANIZATIONID"] === "selected",
              ))?.headers,
            ).toEqual(headers("selected"))

            // A new login is a new connection, so its own default team applies again.
            yield* credentials.create({
              integrationID,
              label: "b@example.test",
              value: oauth({ server: backend.url, organizationID: "selected", email: "b@example.test" }),
            })
            expect(
              (yield* eventually(providers.get(kilo), (provider) => provider?.headers?.["X-KILOCODE-ORGANIZATIONID"] === "selected"))
                ?.headers,
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
