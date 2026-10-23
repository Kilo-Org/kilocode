import { expect } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { Bus } from "@opencode/core/bus"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { KiloPlugin } from "@opencode/core/plugin/provider/kilo"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { Event } from "@opencode/schema/config"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Global } from "@opencode/util/global"
import { Effect, Exit, Queue, Scope } from "effect"
import { TestClock } from "effect/testing"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloGatewayPlugin } from "../src/gateway"

const it = testEffect(PluginTestLayer)
const kilo = Provider.ID.make("kilo")
const env = {
  KILO_API_KEY: "recovery-token",
  KILOCODE_TOKEN: undefined,
  KILO_AUTH_CONTENT: undefined,
  KILO_AI_GATEWAY_URL: undefined,
  KILO_ORG_ID: "first",
}

const addPlugin = Effect.fn(function* () {
  const providers = yield* Provider.Service
  const updates = yield* Queue.unbounded<void>()
  const parent = yield* Scope.Scope
  const scope = yield* Scope.fork(parent)
  yield* Effect.gen(function* () {
    yield* providers.transform((editor) => {
      editor.update(kilo, (provider) => {
        provider.integrationID = Integration.ID.make("kilo")
        provider.package = "@opencode/ai/providers/openai-compatible"
      })
      editor.models.set(kilo, [Model.Info.default(kilo, Model.ID.make("models-dev/only"))])
    })
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    yield* KiloPlugin.effect(host)
    yield* KiloGatewayPlugin.effect({
      ...host,
      provider: {
        ...host.provider,
        reload: () => host.provider.reload().pipe(Effect.andThen(Queue.offer(updates, undefined)), Effect.asVoid),
      },
    }).pipe(Effect.provide(Global.layerWith({})))
  }).pipe(Scope.provide(scope))
  return { updates, scope }
})

const catalogRequests = (backend: ReturnType<typeof fixture>) =>
  backend.requests.filter((request) => request.path.endsWith("/models"))

it.effect("recovers beyond six retries with 30/60/120/240/300-second backoff and stops after success", () =>
  Effect.gen(function* () {
    const backend = yield* Effect.acquireRelease(
      Effect.sync(() => fixture()),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    )
    yield* withEnv({ ...env, KILO_API_URL: backend.url }, () =>
      Effect.gen(function* () {
        backend.state.teamModelsStatus = 503
        const running = yield* addPlugin()
        const models = yield* Model.Service
        const providers = yield* Provider.Service
        const rpc = yield* Rpc.Service
        expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual([])
        expect((yield* providers.available()).some((provider) => provider.id === kilo)).toBe(false)
        expect(yield* rpc.client(KiloGatewayRpc.Definition).models({}).pipe(Effect.flip)).toMatchObject({
          type: "failed",
          data: { kind: "http", status: 503 },
        })
        const delays = [30, 60, 120, 240, 300, 300, 300, 300]
        for (const [index, delay] of delays.entries()) {
          yield* TestClock.adjust((delay - 1) * 1000)
          expect(catalogRequests(backend)).toHaveLength(index + 1)
          if (index === delays.length - 1) backend.state.teamModelsStatus = 200
          yield* TestClock.adjust("1 second")
          yield* Queue.take(running.updates)
          expect(catalogRequests(backend)).toHaveLength(index + 2)
        }
        expect((yield* models.available()).filter((model) => model.providerID === kilo).map((model) => model.id))
          .toEqual([Model.ID.make("anthropic/claude-sonnet-4.6"), Model.ID.make("kilo-auto/small")])
        expect(yield* rpc.client(KiloGatewayRpc.Definition).models({})).toHaveLength(2)
        yield* TestClock.adjust("10 minutes")
        expect(catalogRequests(backend)).toHaveLength(9)
        expect(yield* Queue.size(running.updates)).toBe(0)
      }),
    )
  }),
)

for (const scenario of [401, 403, 404, "schema"] as const) {
  it.effect(`does not schedule recovery for permanent ${scenario} catalog failures`, () =>
    Effect.gen(function* () {
      const backend = yield* Effect.acquireRelease(
        Effect.sync(() => fixture()),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      )
      yield* withEnv({ ...env, KILO_API_URL: backend.url }, () =>
        Effect.gen(function* () {
          if (scenario === "schema") backend.state.teamModels = { invalid: true }
          if (scenario !== "schema") backend.state.teamModelsStatus = scenario
          const running = yield* addPlugin()
          const rpc = yield* Rpc.Service
          const failure = yield* rpc.client(KiloGatewayRpc.Definition).models({}).pipe(Effect.flip)
          expect(failure).toMatchObject({
            type: "failed",
            data: scenario === "schema"
              ? { kind: "schema" }
              : { kind: scenario === 404 ? "http" : "unauthorized", status: scenario },
          })
          yield* TestClock.adjust("1 hour")
          expect(catalogRequests(backend)).toHaveLength(1)
          expect(yield* Queue.size(running.updates)).toBe(0)
          expect(yield* rpc.client(KiloGatewayRpc.Definition).models({}).pipe(Effect.flip)).toEqual(failure)
          const models = yield* Model.Service
          expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual([])
        }),
      )
    }),
  )
}

for (const scenario of [
  { status: 503, seconds: 30 },
  { status: 503, seconds: 120, retryAfter: "120" },
  { status: 408, seconds: 90, retryAfter: "90" },
  { status: 429, seconds: 90, retryAfter: "90" },
  { status: 200, seconds: 30 },
]) {
  it.effect(`recovers ${scenario.status === 200 ? "empty" : scenario.status} catalogs after ${scenario.seconds} seconds`, () =>
    Effect.gen(function* () {
      const backend = yield* Effect.acquireRelease(
        Effect.sync(() => fixture()),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      )
      yield* withEnv({ ...env, KILO_API_URL: backend.url }, () =>
        Effect.gen(function* () {
          const catalog = backend.state.teamModels
          backend.state.teamModelsStatus = scenario.status
          backend.state.modelsRetryAfter = scenario.retryAfter
          if (scenario.status === 200) backend.state.teamModels = { data: [] }
          const running = yield* addPlugin()
          const models = yield* Model.Service
          expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual([])
          yield* TestClock.adjust((scenario.seconds - 1) * 1000)
          expect(catalogRequests(backend)).toHaveLength(1)
          backend.state.teamModelsStatus = 200
          backend.state.teamModels = catalog
          backend.state.modelsRetryAfter = undefined
          yield* TestClock.adjust("1 second")
          yield* Queue.take(running.updates)
          expect(catalogRequests(backend)).toHaveLength(2)
          expect((yield* models.available()).filter((model) => model.providerID === kilo)).toHaveLength(2)
          const rpc = yield* Rpc.Service
          expect(yield* rpc.client(KiloGatewayRpc.Definition).models({})).toHaveLength(2)
          yield* TestClock.adjust("10 minutes")
          expect(catalogRequests(backend)).toHaveLength(2)
        }),
      )
    }),
  )
}

it.effect("retries an actual network failure and recovers when the local Gateway returns", () =>
  Effect.gen(function* () {
    const backend = yield* Effect.acquireRelease(
      Effect.sync(() => fixture()),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    )
    const offline = fixture()
    offline[Symbol.dispose]()
    yield* withEnv({ ...env, KILO_API_URL: backend.url, KILO_AI_GATEWAY_URL: `${offline.url}/api/v1` }, () =>
      Effect.gen(function* () {
        const running = yield* addPlugin()
        const rpc = yield* Rpc.Service
        expect(yield* rpc.client(KiloGatewayRpc.Definition).models({}).pipe(Effect.flip)).toMatchObject({
          type: "failed",
          data: { kind: "network" },
        })
        yield* TestClock.adjust("29 seconds")
        expect(catalogRequests(backend)).toHaveLength(0)
        expect(yield* Queue.size(running.updates)).toBe(0)
        yield* Effect.acquireRelease(
          Effect.sync(() => Bun.serve({
            hostname: "127.0.0.1",
            port: Number(new URL(offline.url).port),
            fetch: (request) => fetch(`${backend.url}${new URL(request.url).pathname}`, { headers: request.headers }),
          })),
          (server) => Effect.sync(() => server.stop(true)),
        )
        yield* TestClock.adjust("1 second")
        yield* Queue.take(running.updates)
        expect(catalogRequests(backend)).toHaveLength(1)
        expect(yield* rpc.client(KiloGatewayRpc.Definition).models({})).toHaveLength(2)
      }),
    )
  }),
)

it.effect("cancels old account retries, retries a reselected failed scope, and cancels recovery on scope close", () =>
  Effect.gen(function* () {
    const backend = yield* Effect.acquireRelease(
      Effect.sync(() => fixture()),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    )
    yield* withEnv({ ...env, KILO_API_URL: backend.url }, () =>
      Effect.gen(function* () {
        backend.state.teamModelsStatus = 503
        const running = yield* addPlugin()
        const bus = yield* Bus.Service
        const models = yield* Model.Service
        yield* withEnv({ KILO_API_KEY: "other-token", KILO_ORG_ID: "selected" }, () =>
          Effect.gen(function* () {
            backend.state.teamModelsStatus = 200
            yield* bus.publish(Event.Updated, {})
            yield* Queue.take(running.updates)
            yield* Queue.take(running.updates)
            expect((yield* models.available()).filter((model) => model.providerID === kilo)).toHaveLength(2)
            yield* TestClock.adjust("30 seconds")
            expect(catalogRequests(backend).map((request) => request.authorization))
              .toEqual(["Bearer recovery-token", "Bearer other-token"])
          }),
        )
        backend.state.teamModelsStatus = 503
        yield* bus.publish(Event.Updated, {})
        yield* Queue.take(running.updates)
        yield* Queue.take(running.updates)
        expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual([])
        yield* TestClock.adjust("29 seconds")
        expect(catalogRequests(backend)).toHaveLength(3)
        backend.state.teamModelsStatus = 200
        yield* TestClock.adjust("1 second")
        yield* Queue.take(running.updates)
        expect((yield* models.available()).filter((model) => model.providerID === kilo)).toHaveLength(2)
        backend.state.teamModelsStatus = 503
        yield* bus.publish(Event.Updated, {})
        yield* Queue.take(running.updates)
        expect((yield* models.available()).filter((model) => model.providerID === kilo)).toEqual([])
        const calls = catalogRequests(backend)
        expect(calls).toHaveLength(5)
        yield* Scope.close(running.scope, Exit.void)
        yield* TestClock.adjust("1 hour")
        expect(catalogRequests(backend)).toEqual(calls)
        expect(yield* Queue.size(running.updates)).toBe(0)
      }),
    )
  }),
)
