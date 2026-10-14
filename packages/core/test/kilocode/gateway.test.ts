import { describe, expect } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { KiloGatewayPlugin } from "@opencode/core/kilocode/gateway"
import { KiloGatewayRpc } from "@opencode/core/kilocode/gateway-rpc"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
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
  KILO_ORG_ID: undefined,
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

// Adds the provider with a static models.dev-style seed model (`models-dev/only`), then starts the plugin.
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
  it.effect("replaces the upstream Kilo plugin", () =>
    Effect.sync(() => {
      const ids = ProviderPlugins.map((item) => item.id)
      expect(ids).toContain("kilocode.gateway")
      expect(ids).not.toContain("opencode.provider.kilo")
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
            expect(provider?.settings?.baseURL).toBe(`${backend.url}/api/gateway`)
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
            expect(provider?.settings).toMatchObject({ baseURL: `${backend.url}/api/gateway`, apiKey: "anonymous" })
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
            expect(signedIn?.settings?.baseURL).toBe(`${backend.url}/api/gateway`)
            expect(signedIn?.settings).not.toHaveProperty("apiKey")
            expect(signedIn?.activation).toBe("auto")
            expect(
              (yield* models.available())
                .filter((item) => item.providerID === kilo)
                .map((item) => item.id),
            ).toEqual([Model.ID.make("anthropic/claude-sonnet-4.6"), Model.ID.make("kilo-auto/small")])
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
})
