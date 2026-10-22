import { expect } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigAgentPlugin } from "@opencode/core/config/plugin/agent"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { AgentPlugin } from "@opencode/core/plugin/agent"
import { PluginHost } from "@opencode/core/plugin/host"
import { PlanPlugin } from "@opencode/core/plugin/plan"
import { Provider } from "@opencode/core/provider"
import { Document, Event } from "@opencode/schema/config"
import { IntegrationID } from "@opencode/schema/integration-id"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Global } from "@opencode/util/global"
import { Effect, Fiber, Layer, Stream } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloAgentPlugin } from "../src/agent"
import { KiloGatewayPlugin } from "../src/gateway"
import { KiloGatewayPolicyPlugin } from "../src/gateway/policy"

const layer = Layer.mergeAll(PluginTestLayer, Global.layerWith({}))
const it = testEffect(layer)
const kilo = Provider.ID.make("kilo")
const other = Provider.ID.make("other")
const code = Agent.ID.make("code")
const defaults = [
  { action: "edit", resource: "*", effect: "allow" },
  { action: "shell", resource: "*", effect: "deny" },
] as const

function enterprise<A, E, R>(body: (backend: ReturnType<typeof fixture>) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => fixture()),
    (backend) =>
      withEnv(
        {
          KILO_API_URL: backend.url,
          KILO_AI_GATEWAY_URL: undefined,
          KILO_API_KEY: "fixture-token",
          KILOCODE_TOKEN: undefined,
          KILO_AUTH_CONTENT: undefined,
          KILO_ORG_ID: "selected",
          KILO_DATA_COLLECTION: undefined,
        },
        () => body(backend),
      ),
    (backend) => Effect.sync(() => backend[Symbol.dispose]()),
  )
}

const mode = (slug: string, groups: string[]) => ({
  id: slug,
  organization_id: "selected",
  slug,
  name: slug,
  created_by: "fixture",
  created_at: "2026-10-01",
  updated_at: "2026-10-01",
  config: { roleDefinition: `Organization ${slug}`, groups },
})

const setup = Effect.fn(function* (info: KiloConfigPolicy.Info, managedPrivacy = false) {
  const config = yield* Config.Test
  yield* config.setEntries([
    new Document({ type: "document", info }),
    ...(managedPrivacy
      ? [
          new Document({
            type: "document",
            info: new KiloConfigPolicy.Info({ hide_prompt_training_models: true }),
          }),
        ]
      : []),
  ])
  const agents = yield* Agent.Service
  const providers = yield* Provider.Service
  const models = yield* Model.Service
  yield* providers.transform((editor) => {
    editor.update(kilo, (provider) => {
      provider.integrationID = IntegrationID.make("kilo")
      provider.package = "@opencode/ai/providers/openrouter"
    })
    editor.update(other, (provider) => {
      provider.activation = "enabled"
    })
    editor.models.set(other, [
      {
        ...Model.Info.default(other, Model.ID.make("unrelated")),
        time: { released: 1 },
      },
    ])
  })
  const plugins = yield* Plugin.Service
  const host = yield* PluginHost.make(plugins)
  yield* AgentPlugin.Plugin.effect(host)
  yield* PlanPlugin.Plugin.effect(host)
  yield* KiloAgentPlugin.Plugin.effect(host)
  yield* KiloGatewayPlugin.effect(host)
  yield* ConfigAgentPlugin.Plugin.effect(host)
  yield* ConfigProviderPlugin.Plugin.effect(host)
  yield* KiloGatewayPolicyPlugin.effect(host)
  yield* KiloAgentPlugin.Ceiling.effect(host)
  return { agents, models, host, config, gateway: host.rpc(KiloGatewayRpc.Definition) }
})

const permission = Effect.fn(function* (id: string, action: string, resource = "*") {
  const agents = yield* Agent.Service
  const agent = yield* agents.get(Agent.ID.make(id))
  expect(agent).toBeDefined()
  return Permission.evaluate(action, resource, agent!.permissions).effect
})

it.live("organization permissions follow global defaults without changing non-organization agents", () =>
  enterprise((backend) =>
    Effect.gen(function* () {
      backend.state.modes = { modes: [mode("code", ["read"]), mode("runner", ["command"]), mode("empty", [])] }
      const result = yield* setup(new KiloConfigPolicy.Info({ permissions: defaults }))
      expect((yield* result.agents.get(code))?.system).toBe("Organization code")
      expect(yield* permission("code", "edit")).toBe("deny")
      expect(yield* permission("code", "shell")).toBe("deny")
      expect(yield* permission("runner", "shell", "git push")).toBe("allow")
      for (const action of ["read", "edit", "shell"]) {
        expect(yield* permission("empty", action)).toBe("deny")
      }
      expect(yield* permission("debug", "edit")).toBe("allow")
      expect(yield* permission("debug", "shell")).toBe("deny")
      expect(yield* permission("ask", "edit")).toBe("deny")
      expect(yield* permission("plan", "edit")).toBe("deny")
    }),
  ),
)

it.live("explicit local agent instructions and permissions override organization rules after config reload", () =>
  enterprise((backend) =>
    Effect.gen(function* () {
      backend.state.modes = { modes: [mode("code", ["read"]), mode("runner", ["command"])] }
      const result = yield* setup(new KiloConfigPolicy.Info({ permissions: defaults }))
      const bus = yield* Bus.Service
      const updated = yield* bus.subscribe(Agent.Event.Updated).pipe(
        Stream.filterEffect(() =>
          result.agents
            .get(code)
            .pipe(
              Effect.map(
                (agent) =>
                  agent?.system === "Local instructions" &&
                  Permission.evaluate("edit", "docs/guide.md", agent.permissions).effect === "allow" &&
                  Permission.evaluate("edit", "src/index.ts", agent.permissions).effect === "deny",
              ),
            ),
        ),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* result.config.setEntries([
        new Document({
          type: "document",
          info: new KiloConfigPolicy.Info({
            permissions: defaults,
            agents: {
              code: {
                system: "Local instructions",
                permissions: [{ action: "edit", resource: "docs/*", effect: "allow" }],
              },
              runner: { permissions: [{ action: "shell", resource: "*", effect: "deny" }] },
            },
          }),
        }),
      ])
      yield* bus.publish(Event.Updated, {})
      yield* Fiber.join(updated).pipe(Effect.timeout("5 seconds"))
      expect((yield* result.agents.get(code))?.system).toBe("Local instructions")
      expect(yield* permission("code", "edit", "docs/guide.md")).toBe("allow")
      expect(yield* permission("code", "edit", "src/index.ts")).toBe("deny")
      expect(yield* permission("runner", "shell", "git push")).toBe("deny")
      yield* result.agents.reload()
      expect(yield* permission("code", "edit", "docs/guide.md")).toBe("allow")
      expect(yield* permission("code", "edit", "src/index.ts")).toBe("deny")
    }),
  ),
)

it.live("mode replacement and removal rebuild permission spans instead of retaining old organization rules", () =>
  enterprise((backend) =>
    Effect.gen(function* () {
      backend.state.modes = { modes: [mode("code", ["read"]), mode("removed", ["read"])] }
      const result = yield* setup(new KiloConfigPolicy.Info({ permissions: defaults }))
      expect(yield* permission("code", "edit")).toBe("deny")
      backend.state.modes = { modes: [mode("code", ["command"])] }
      yield* result.gateway["organization.set"]({ organizationID: "first" })
      expect(yield* result.agents.get(Agent.ID.make("removed"))).toBeUndefined()
      expect(yield* permission("code", "read")).toBe("deny")
      expect(yield* permission("code", "shell", "git push")).toBe("allow")
      yield* result.agents.reload()
      yield* result.agents.reload()
      expect(yield* permission("code", "edit")).toBe("deny")
      expect(yield* permission("code", "shell", "git push")).toBe("allow")
      backend.state.modes = { modes: [] }
      yield* result.gateway["organization.set"]({ organizationID: "selected" })
      expect((yield* result.agents.get(code))?.system).toBeUndefined()
      expect(yield* permission("code", "edit")).toBe("allow")
      expect(yield* permission("code", "shell")).toBe("deny")
    }),
  ),
)

it.live("separate location contexts do not share organization permission spans", () =>
  enterprise((backend) =>
    Effect.gen(function* () {
      backend.state.modes = { modes: [mode("code", ["read"])] }
      const first = yield* setup(new KiloConfigPolicy.Info({ permissions: defaults }))
      backend.state.modes = { modes: [mode("code", ["command", "custom"])] }
      yield* Effect.scoped(
        withEnv({ KILO_ORG_ID: "first" }, () =>
          Effect.gen(function* () {
            const second = yield* setup(new KiloConfigPolicy.Info({ permissions: defaults }))
            expect(second.host.location.directory).not.toBe(first.host.location.directory)
            yield* first.agents.reload()
            yield* second.agents.reload()
            const firstRules = (yield* first.agents.get(code))!.permissions
            const secondRules = (yield* second.agents.get(code))!.permissions
            expect(Permission.evaluate("read", "src/index.ts", firstRules).effect).toBe("allow")
            expect(Permission.evaluate("shell", "git push", firstRules).effect).toBe("deny")
            expect(Permission.evaluate("read", "src/index.ts", secondRules).effect).toBe("deny")
            expect(Permission.evaluate("shell", "git push", secondRules).effect).toBe("allow")
            expect(Permission.evaluate("edit", "src/index.ts", firstRules).effect).toBe("deny")
            expect(Permission.evaluate("edit", "src/index.ts", secondRules).effect).toBe("deny")
          }),
        ).pipe(Effect.provide(Layer.fresh(layer))),
      )
      expect(yield* permission("code", "read")).toBe("allow")
      expect(yield* permission("code", "shell")).toBe("deny")
    }),
  ),
)

for (const scenario of [
  {
    name: "repairs a hidden explicit default with the nonfirst Gateway recommendation",
    recommended: "recommended",
    selected: "training",
    empty: false,
    expected: "kilo/recommended",
  },
  {
    name: "repairs a hidden alias default with the Gateway recommendation",
    recommended: "recommended",
    selected: "training-alias",
    empty: false,
    expected: "kilo/recommended",
  },
  {
    name: "keeps the fallback in Kilo when its recommendation is hidden",
    recommended: "training",
    selected: undefined,
    empty: false,
    expected: "kilo/first",
  },
  {
    name: "preserves a safe explicit Kilo default",
    recommended: "recommended",
    selected: "first",
    empty: false,
    expected: "kilo/first",
  },
  {
    name: "preserves a safe explicit other-provider default",
    recommended: "training",
    selected: "other",
    empty: false,
    expected: "other/unrelated",
  },
  {
    name: "keeps the baseline all-provider fallback when no Kilo model survives",
    recommended: "training",
    selected: "training",
    empty: true,
    expected: "other/unrelated",
  },
]) {
  it.live(`managed privacy ${scenario.name}`, () =>
    enterprise((backend) =>
      Effect.gen(function* () {
        backend.state.teamModels = {
          data: [
            { id: "training", name: "Training", context_length: 128000, mayTrainOnYourPrompts: true },
            ...(scenario.empty
              ? []
              : [
                  { id: "first", name: "First private", context_length: 128000 },
                  { id: "recommended", name: "Recommended private", context_length: 128000 },
                ]),
          ],
        }
        backend.state.teamDefaults = { defaultModel: scenario.recommended }
        const result = yield* setup(
          new KiloConfigPolicy.Info({
            hide_prompt_training_models: false,
            ...(scenario.selected
              ? {
                  model: {
                    providerID: scenario.selected === "other" ? other : kilo,
                    model: Model.ID.make(scenario.selected === "other" ? "unrelated" : scenario.selected),
                  },
                }
              : {}),
            providers: {
              kilo: {
                models: {
                  training: {},
                  "training-alias": { modelID: Model.ID.make("training") },
                },
              },
            },
          }),
          true,
        )
        expect(yield* result.models.get(kilo, Model.ID.make("training"))).toBeUndefined()
        expect(yield* result.models.get(kilo, Model.ID.make("training-alias"))).toBeUndefined()
        expect(
          (yield* result.models.available()).filter((model) => model.providerID === kilo).map((model) => model.id),
        ).toEqual(scenario.empty ? [] : [Model.ID.make("first"), Model.ID.make("recommended")])
        const selected = yield* result.models.default()
        expect(`${selected?.providerID}/${selected?.id}`).toBe(scenario.expected)
        expect((yield* result.gateway.models({})).find((model) => model.recommended)?.id).toBe(scenario.recommended)
      }),
    ),
  )
}
