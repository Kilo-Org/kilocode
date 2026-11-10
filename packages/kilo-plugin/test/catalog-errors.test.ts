import { expect } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Global } from "@opencode/util/global"
import { Effect, Schema } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloGatewayPlugin } from "../src/gateway"

const it = testEffect(PluginTestLayer)
const kilo = Provider.ID.make("kilo")

for (const scenario of ["http", "network", "schema", "missing-team"] as const) {
  it.live(`reports a safe catalog diagnostic for ${scenario}`, () =>
    Effect.gen(function* () {
      const backend = yield* Effect.acquireRelease(
        Effect.sync(() => fixture()),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      )
      if (scenario === "http") {
        backend.state.modelsStatus = 503
        backend.state.modelsRetryAfter = "120"
      }
      if (scenario === "schema") backend.state.models = { privateBody: "private-response-body" }
      if (scenario === "network") backend[Symbol.dispose]()
      yield* withEnv(
        {
          KILO_API_URL: backend.url,
          KILO_AI_GATEWAY_URL: undefined,
          KILO_API_KEY: "private-api-token",
          KILOCODE_TOKEN: undefined,
          KILO_AUTH_CONTENT: undefined,
          KILO_ORG_ID: scenario === "missing-team" ? "private-missing-team" : undefined,
        },
        () =>
          Effect.gen(function* () {
            const providers = yield* Provider.Service
            yield* providers.transform((editor) => {
              editor.models.set(kilo, [Model.Info.default(kilo, Model.ID.make("models-dev/only"))])
            })
            const plugin = yield* Plugin.Service
            const host = yield* PluginHost.make(plugin, "test")
            yield* KiloGatewayPlugin.effect(host).pipe(Effect.provide(Global.layerWith({})))
            const rpc = yield* Rpc.Service
            const failure = yield* rpc.client(KiloGatewayRpc.Definition).models({}).pipe(Effect.flip)
            const reason = scenario === "http" ? "HTTP 503" : scenario
            expect(failure).toEqual({
              type: "failed",
              message:
                scenario === "missing-team"
                  ? "The selected Kilo team is no longer available. Select another team or clear the team selection."
                  : `Failed to load the Kilo model catalog (${reason}). Check your connection and credentials.`,
              data: {
                kind: scenario === "http" ? "http" : scenario === "missing-team" ? "organization_missing" : scenario,
                ...(scenario === "http" ? { status: 503 } : {}),
              },
            })
            if (scenario === "missing-team") expect(failure).not.toHaveProperty("data.status")
            expect((yield* providers.available()).some((provider) => provider.id === kilo)).toBe(false)
            const models = yield* Model.Service
            expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual([])
          }),
      )
    }),
  )
}

it.effect("catalog failure data validates the public shape and omits an undefined status", () =>
  Effect.sync(() => {
    expect(Schema.encodeSync(KiloGatewayRpc.CatalogFailure)({ kind: "network", status: undefined })).toEqual({
      kind: "network",
    })
    for (const invalid of [{ kind: "private-token" }, { kind: "http", status: "503" }, { kind: "http", status: 600 }]) {
      expect(() => Schema.decodeUnknownSync(KiloGatewayRpc.CatalogFailure)(invalid)).toThrow()
    }
  }),
)

// Each catalog failure has a typed reason, and `catalog.status` reports the same reason as the `models` error.
const reasons = [
  { name: "team 401", env: { KILO_ORG_ID: "selected" }, failure: { kind: "unauthorized", status: 401 } },
  { name: "missing token", env: { KILO_API_KEY: undefined, KILO_ORG_ID: "selected" }, failure: { kind: "unauthenticated" } },
  { name: "token scope", env: { KILO_ORG_ID: "selected" }, scopedTo: "first", failure: { kind: "scope_conflict" } },
  { name: "team-only account", env: {}, failure: { kind: "personal_unavailable" } },
  { name: "profile outage", env: {}, failure: { kind: "http", status: 500 } },
] as const

for (const reason of reasons) {
  it.live(`reports the ${reason.failure.kind} reason for a ${reason.name}`, () =>
    Effect.gen(function* () {
      const backend = yield* Effect.acquireRelease(
        Effect.sync(() => fixture()),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      )
      if (reason.name === "team 401") backend.state.teamModelsStatus = 401
      if (reason.name === "team-only account")
        backend.state.profile = { user: { email: "team@example.test" }, organizations: [], hasPersonalAccount: false }
      if (reason.name === "profile outage") backend.state.profileStatus = 500
      yield* withEnv(
        {
          KILO_API_URL: backend.url,
          KILO_AI_GATEWAY_URL: undefined,
          KILO_API_KEY: "scopedTo" in reason ? `${backend.url}/api/organizations/${reason.scopedTo}:secret` : "token",
          KILOCODE_TOKEN: undefined,
          KILO_AUTH_CONTENT: undefined,
          KILO_ORG_ID: undefined,
          ...reason.env,
        },
        () =>
          Effect.gen(function* () {
            const plugin = yield* Plugin.Service
            const host = yield* PluginHost.make(plugin, "test")
            yield* KiloGatewayPlugin.effect(host).pipe(Effect.provide(Global.layerWith({})))
            const rpc = yield* Rpc.Service
            const client = rpc.client(KiloGatewayRpc.Definition)
            expect(yield* client.models({}).pipe(Effect.flip)).toMatchObject({ type: "failed", data: reason.failure })
            expect(yield* client["catalog.status"]({})).toEqual({ failure: reason.failure })
          }),
      )
    }),
  )
}

it.live("reports no reason for a usable catalog", () =>
  Effect.gen(function* () {
    const backend = yield* Effect.acquireRelease(
      Effect.sync(() => fixture()),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    )
    yield* withEnv(
      {
        KILO_API_URL: backend.url,
        KILO_AI_GATEWAY_URL: undefined,
        KILO_API_KEY: undefined,
        KILOCODE_TOKEN: undefined,
        KILO_AUTH_CONTENT: undefined,
        KILO_ORG_ID: undefined,
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const host = yield* PluginHost.make(plugin, "test")
          yield* KiloGatewayPlugin.effect(host).pipe(Effect.provide(Global.layerWith({})))
          const rpc = yield* Rpc.Service
          expect(yield* rpc.client(KiloGatewayRpc.Definition)["catalog.status"]({})).toEqual({ failure: null })
        }),
    )
  }),
)
