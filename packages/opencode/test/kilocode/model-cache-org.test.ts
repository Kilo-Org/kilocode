// Regression test: OAuth accountId must flow into model fetch as kilocodeOrganizationId
// When a user logs in via OAuth and selects an enterprise organization, the model fetch
// should use the organization-specific endpoint, not the personal endpoint.

import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

type Options = Parameters<ModelCache.KiloModels["fetch"]>[0]

function layer(info: Auth.Info | undefined, captured: Ref.Ref<Options | undefined>) {
  const auth = Layer.mock(Auth.Service)({
    get: (id) => Effect.succeed(id === "kilo" ? info : undefined),
  })
  const models = Layer.succeed(
    ModelCache.KiloModelsService,
    ModelCache.KiloModelsService.of({
      fetch: (options) =>
        Ref.set(captured, options).pipe(
          Effect.as({
            models: {
              "test-model": {
                id: "test-model",
                name: "Test Model",
                cost: { input: 0.001, output: 0.002 },
                limit: { context: 128000, output: 4096 },
              },
            },
          }),
        ),
    }),
  )
  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(TestConfig.layer()),
    Layer.provide(auth),
    Layer.provide(models),
  )
}

const it = testEffect(Layer.empty)

it.live("switch invalidation drops warm Personal and delayed prior catalogs", () =>
  Effect.gen(function* () {
    const account = yield* Ref.make<string | undefined>(undefined)
    const started = yield* Deferred.make<void>()
    const wait = yield* Deferred.make<void>()
    const calls: Options[] = []
    const auth = Layer.mock(Auth.Service)({
      get: () =>
        Ref.get(account).pipe(
          Effect.map(
            (accountId) =>
              new Auth.Oauth({
                type: "oauth",
                access: "test-token",
                refresh: "test-refresh",
                expires: 0,
                accountId,
              }),
          ),
        ),
    })
    const models = Layer.succeed(
      ModelCache.KiloModelsService,
      ModelCache.KiloModelsService.of({
        fetch: (options) =>
          Effect.gen(function* () {
            calls.push(options)
            if (calls.length === 2) {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(wait)
            }
            const id = options.kilocodeOrganizationId ?? "personal"
            return { models: { [id]: { id, name: id, limit: { context: 128000, output: 4096 } } } }
          }),
      }),
    )
    const cache = Layer.fresh(ModelCache.layer).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(TestConfig.layer()),
      Layer.provide(auth),
      Layer.provide(models),
    )
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        expect(Object.keys(yield* cache.fetch("kilo"))).toEqual(["personal"])
        const pending = yield* cache.refresh("kilo").pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* Ref.set(account, "org-a")
        yield* cache.clear("kilo")
        expect(yield* cache.get("kilo")).toBeUndefined()
        expect(Object.keys(yield* cache.fetch("kilo"))).toEqual(["org-a"])
        yield* Deferred.succeed(wait, undefined)
        yield* Fiber.join(pending)
        expect(Object.keys((yield* cache.get("kilo")) ?? {})).toEqual(["org-a"])
        expect(yield* cache.getFailure("kilo")).toBeUndefined()
        yield* Ref.set(account, "org-b")
        yield* cache.clear("kilo")
        expect(Object.keys(yield* cache.fetch("kilo"))).toEqual(["org-b"])
        yield* Ref.set(account, undefined)
        yield* cache.clear("kilo")
        expect(Object.keys(yield* cache.fetch("kilo"))).toEqual(["personal"])
        expect(calls.map((options) => options.kilocodeOrganizationId)).toEqual([
          undefined,
          undefined,
          "org-a",
          "org-b",
          undefined,
        ])
      }),
    ).pipe(Effect.provide(cache))
  }),
)

it.live("model fetch uses accountId from OAuth auth as kilocodeOrganizationId", () =>
  Effect.gen(function* () {
    const captured = yield* Ref.make<Options | undefined>(undefined)
    const info = new Auth.Oauth({
      type: "oauth",
      access: "test-oauth-token",
      refresh: "test-refresh-token",
      expires: Date.now() + 3600000,
      accountId: "org-enterprise-123",
    })
    yield* ModelCache.Service.use((cache) => cache.fetch("kilo")).pipe(Effect.provide(layer(info, captured)))
    expect(yield* Ref.get(captured)).toMatchObject({
      kilocodeToken: "test-oauth-token",
      kilocodeOrganizationId: "org-enterprise-123",
    })
  }),
)

it.live("model fetch without OAuth accountId does not set kilocodeOrganizationId", () =>
  Effect.gen(function* () {
    const captured = yield* Ref.make<Options | undefined>(undefined)
    const info = new Auth.Oauth({
      type: "oauth",
      access: "test-personal-token",
      refresh: "test-refresh-token",
      expires: Date.now() + 3600000,
    })
    yield* ModelCache.Service.use((cache) => cache.fetch("kilo")).pipe(Effect.provide(layer(info, captured)))
    expect(yield* Ref.get(captured)).toMatchObject({ kilocodeToken: "test-personal-token" })
    expect((yield* Ref.get(captured))?.kilocodeOrganizationId).toBeUndefined()
  }),
)

it.live("ModelCache.clear removes cached entry so next fetch hits the network", () =>
  Effect.gen(function* () {
    const captured = yield* Ref.make<Options | undefined>(undefined)
    const info = new Auth.Oauth({
      type: "oauth",
      access: "token-clear-test",
      refresh: "refresh-clear",
      expires: Date.now() + 3600000,
      accountId: "org-clear",
    })
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo")
        expect(yield* Ref.get(captured)).toBeDefined()

        yield* Ref.set(captured, undefined)
        yield* cache.fetch("kilo")
        expect(yield* Ref.get(captured)).toBeUndefined()
        expect(yield* cache.get("kilo")).toBeDefined()

        yield* cache.clear("kilo")
        expect(yield* cache.get("kilo")).toBeUndefined()

        yield* cache.fetch("kilo")
        expect(yield* Ref.get(captured)).toBeDefined()
      }),
    ).pipe(Effect.provide(layer(info, captured)))
  }),
)
