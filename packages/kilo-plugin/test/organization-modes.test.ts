import { expect } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Credential } from "@opencode/core/credential"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { IntegrationID, IntegrationMethodID } from "@opencode/schema/integration-id"
import { Document } from "@opencode/schema/config"
import { Global } from "@opencode/util/global"
import { Effect, Fiber, Schedule } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloGatewayPlugin } from "../src/gateway"

const it = testEffect(PluginTestLayer)
const kilo = Provider.ID.make("kilo")
const integrationID = IntegrationID.make("kilo")
const mode = (slug: string, role: string) => ({
  id: slug,
  organization_id: "fixture",
  name: slug,
  slug,
  created_by: "fixture",
  created_at: "2026-10-01",
  updated_at: "2026-10-01",
  config: { roleDefinition: role, groups: ["read"] },
})

it.live("applies real agents, respects local overrides, and replaces organization agents on switch and logout", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => fixture()),
    (backend) =>
      withEnv(
        {
          KILO_API_URL: backend.url,
          KILO_API_KEY: undefined,
          KILOCODE_TOKEN: undefined,
          KILO_AUTH_CONTENT: undefined,
          KILO_ORG_ID: undefined,
        },
        () =>
          Effect.gen(function* () {
            backend.state.modes = { modes: [mode("first-only", "First team"), mode("code", "Team code")] }
            const agents = yield* Agent.Service
            yield* agents.transform((editor) =>
              editor.update(Agent.ID.make("code"), (agent) => {
                agent.system = "Builtin code"
              }),
            )
            const credentials = yield* Credential.Service
            const credential = yield* credentials.create({
              integrationID,
              value: Credential.OAuth.make({
                type: "oauth",
                methodID: IntegrationMethodID.make("device"),
                access: "fixture-token",
                refresh: "fixture-token",
                expires: 0,
                metadata: { server: backend.url, organizationID: "first" },
              }),
            })
            const providers = yield* Provider.Service
            yield* providers.transform((editor) =>
              editor.update(kilo, (provider) => {
                provider.integrationID = integrationID
                provider.package = "@opencode/ai/providers/openrouter"
              }),
            )
            const plugins = yield* Plugin.Service
            yield* KiloGatewayPlugin.effect(yield* PluginHost.make(plugins)).pipe(Effect.provide(Global.layerWith({})))
            expect((yield* agents.get(Agent.ID.make("first-only")))?.system).toBe("First team")
            expect((yield* agents.get(Agent.ID.make("code")))?.system).toBe("Team code")
            // Config agent transforms run after the Gateway, so explicit user instructions still win.
            const local = yield* agents.transform((editor) =>
              editor.update(Agent.ID.make("code"), (agent) => {
                agent.system = "Local code"
              }),
            )
            expect((yield* agents.get(Agent.ID.make("code")))?.system).toBe("Local code")
            yield* local.dispose
            const rpc = yield* Rpc.Service
            const call = (organizationID: string | null) =>
              rpc.call(KiloGatewayRpc.Definition.id, "organization.set", { organizationID })
            const before = backend.requests.length
            backend.state.delay = 100
            const refresh = yield* call("first").pipe(Effect.forkChild({ startImmediately: true }))
            yield* Effect.sync(() =>
              backend.requests.slice(before).some((request) => request.path.endsWith("/profile")),
            ).pipe(
              Effect.repeat({ while: (started) => !started, schedule: Schedule.spaced("1 millis") }),
              Effect.timeout("2 seconds"),
            )
            expect((yield* agents.get(Agent.ID.make("first-only")))?.system).toBe("First team")
            yield* Fiber.join(refresh)
            backend.state.delay = 0
            const profile = backend.state.profile
            backend.state.profile = {
              user: { email: "fixture@example.test" },
              organizations: [],
              hasPersonalAccount: true,
            }
            yield* call("first")
            expect(yield* agents.get(Agent.ID.make("first-only"))).toBeUndefined()
            backend.state.profile = profile
            yield* call("first")
            expect((yield* agents.get(Agent.ID.make("first-only")))?.system).toBe("First team")
            backend.state.modes = { modes: [mode("second-only", "Second team")] }
            yield* call("selected")
            expect(yield* agents.get(Agent.ID.make("first-only"))).toBeUndefined()
            expect((yield* agents.get(Agent.ID.make("second-only")))?.system).toBe("Second team")
            expect((yield* agents.get(Agent.ID.make("code")))?.system).toBe("Builtin code")
            backend.state.modesStatus = 503
            yield* call("first")
            expect(yield* agents.get(Agent.ID.make("second-only"))).toBeUndefined()
            backend.state.modesStatus = 200
            yield* call("selected")
            yield* call(null)
            expect(yield* agents.get(Agent.ID.make("second-only"))).toBeUndefined()
            yield* credentials.remove(credential.id)
            expect(yield* agents.get(Agent.ID.make("first-only"))).toBeUndefined()
          }),
      ),
    (backend) => Effect.sync(() => backend[Symbol.dispose]()),
  ),
)

it.live("managed privacy wins request and environment options, preserves routing, and filters training models", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => fixture()),
    (backend) =>
      withEnv(
        {
          KILO_API_URL: backend.url,
          KILO_API_KEY: "fixture-token",
          KILO_ORG_ID: undefined,
          KILO_DATA_COLLECTION: "allow",
        },
        () =>
          Effect.gen(function* () {
            backend.state.models = {
              data: [
                { id: "training", name: "Training", context_length: 128000, isFree: true, mayTrainOnYourPrompts: true },
                { id: "private", name: "Private", context_length: 128000, isFree: true },
              ],
            }
            backend.state.defaults = { defaultModel: "training" }
            const config = yield* Config.Test
            const user = new Document({
              type: "document",
              info: new KiloConfigPolicy.Info({ hide_prompt_training_models: false }),
            })
            yield* config.setEntries([
              user,
              new Document({
                type: "document",
                info: new KiloConfigPolicy.Info({ hide_prompt_training_models: true }),
              }),
            ])
            const providers = yield* Provider.Service
            yield* providers.transform((editor) =>
              editor.update(kilo, (provider) => {
                provider.integrationID = integrationID
                provider.package = "@opencode/ai/providers/openrouter"
              }),
            )
            const plugins = yield* Plugin.Service
            const host = yield* PluginHost.make(plugins)
            yield* KiloGatewayPlugin.effect(host).pipe(Effect.provide(Global.layerWith({})))
            const models = yield* Model.Service
            expect(
              (yield* models.available()).filter((model) => model.providerID === kilo).map((model) => model.id),
            ).toEqual([Model.ID.make("private")])
            expect((yield* models.default())?.id).toBe(Model.ID.make("private"))
            const session = yield* host.session.create({})
            const hooks = yield* PluginHooks.Service
            const request = yield* hooks.trigger("session", "http.request", {
              sessionID: session.id,
              agent: Agent.ID.make("code"),
              model: { providerID: kilo, id: Model.ID.make("private") },
              kind: "primary",
              request: new Request(`${backend.url}/api/gateway/v1/chat/completions`, {
                method: "POST",
                body: JSON.stringify({
                  provider: { data_collection: "allow", order: ["test-provider"], allow_fallbacks: false },
                }),
              }),
            })
            expect(yield* Effect.promise(() => request.request.json())).toEqual({
              provider: { data_collection: "deny", order: ["test-provider"], allow_fallbacks: false },
            })
            yield* config.setEntries([user])
            // Request-time access re-reads the effective policy, so config changes do not wait for a network refresh.
            const updated = yield* hooks.trigger("session", "http.request", {
              sessionID: session.id,
              agent: Agent.ID.make("code"),
              model: { providerID: kilo, id: Model.ID.make("private") },
              kind: "primary",
              request: new Request(`${backend.url}/api/gateway/v1/chat/completions`, {
                method: "POST",
                body: JSON.stringify({ provider: { data_collection: "allow" } }),
              }),
            })
            expect(yield* Effect.promise(() => updated.request.json())).toEqual({
              provider: { data_collection: "allow" },
            })
          }),
      ),
    (backend) => Effect.sync(() => backend[Symbol.dispose]()),
  ),
)
