// kilocode_change - new file
// Regression tests: the kilo model cache must be keyed by the identity of the request
// (token + organization + baseURL), not by the provider id alone. A public/unauthenticated
// catalog fetched before login must never be served to a later authenticated request, and two
// organizations must not share the same cached catalog.

import { expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

type Options = Parameters<ModelCache.KiloModels["fetch"]>[0]

const label = (options: Options) =>
  options.kilocodeToken
    ? `kilo-${options.kilocodeOrganizationId ?? "personal"}-${options.kilocodeToken}`
    : "kilo-public"

function layer(info: Ref.Ref<Auth.Info | undefined>, calls: Ref.Ref<Options[]>) {
  const auth = Layer.mock(Auth.Service)({
    get: (id) => (id === "kilo" ? Ref.get(info) : Effect.succeed(undefined)),
  })
  const models = Layer.succeed(
    ModelCache.KiloModelsService,
    ModelCache.KiloModelsService.of({
      fetch: (options) =>
        Ref.update(calls, (list) => [...list, options]).pipe(
          Effect.as({ models: { [label(options)]: { id: label(options), name: label(options) } } }),
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

const oauth = (access: string, accountId?: string) =>
  new Auth.Oauth({
    type: "oauth",
    access,
    refresh: `refresh-${access}`,
    expires: Date.now() + 3600000,
    ...(accountId ? { accountId } : {}),
  })

const it = testEffect(Layer.empty)

it.live("an unauthenticated catalog is not reused for a later authenticated fetch", () =>
  Effect.gen(function* () {
    const info = yield* Ref.make<Auth.Info | undefined>(undefined)
    const calls = yield* Ref.make<Options[]>([])
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        expect(Object.keys(yield* cache.fetch("kilo"))).toEqual(["kilo-public"])
        expect((yield* Ref.get(calls)).length).toBe(1)

        // The user logs in while the public catalog is still inside its TTL.
        yield* Ref.set(info, oauth("token-a", "org-a"))
        expect(Object.keys(yield* cache.fetch("kilo"))).toEqual(["kilo-org-a-token-a"])
        expect((yield* Ref.get(calls)).length).toBe(2)
        expect((yield* Ref.get(calls))[1]).toMatchObject({
          kilocodeToken: "token-a",
          kilocodeOrganizationId: "org-a",
        })

        // Both identities keep their own entry; neither leaks into the other.
        expect(Object.keys((yield* cache.get("kilo")) ?? {})).toEqual(["kilo-org-a-token-a"])
        yield* Ref.set(info, undefined)
        expect(Object.keys((yield* cache.get("kilo")) ?? {})).toEqual(["kilo-public"])
        expect((yield* Ref.get(calls)).length).toBe(2)
      }),
    ).pipe(Effect.provide(layer(info, calls)))
  }),
)

it.live("a token change alone invalidates the cached catalog", () =>
  Effect.gen(function* () {
    const info = yield* Ref.make<Auth.Info | undefined>(oauth("token-old"))
    const calls = yield* Ref.make<Options[]>([])
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        expect(Object.keys(yield* cache.fetch("kilo"))).toEqual(["kilo-personal-token-old"])
        yield* Ref.set(info, oauth("token-new"))
        expect(Object.keys(yield* cache.fetch("kilo"))).toEqual(["kilo-personal-token-new"])
        expect((yield* Ref.get(calls)).length).toBe(2)
      }),
    ).pipe(Effect.provide(layer(info, calls)))
  }),
)

it.live("different organizations do not share the active entry", () =>
  Effect.gen(function* () {
    const info = yield* Ref.make<Auth.Info | undefined>(oauth("token-shared", "org-a"))
    const calls = yield* Ref.make<Options[]>([])
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const a = yield* cache.fetch("kilo", { kilocodeOrganizationId: "org-a" })
        const b = yield* cache.fetch("kilo", { kilocodeOrganizationId: "org-b" })
        expect(Object.keys(a)).toEqual(["kilo-org-a-token-shared"])
        expect(Object.keys(b)).toEqual(["kilo-org-b-token-shared"])
        expect((yield* Ref.get(calls)).length).toBe(2)

        expect(yield* cache.get("kilo", { kilocodeOrganizationId: "org-a" })).toEqual(a)
        expect(yield* cache.get("kilo", { kilocodeOrganizationId: "org-b" })).toEqual(b)
      }),
    ).pipe(Effect.provide(layer(info, calls)))
  }),
)

it.live("clear drops every cached identity for the provider", () =>
  Effect.gen(function* () {
    const info = yield* Ref.make<Auth.Info | undefined>(oauth("token-shared", "org-a"))
    const calls = yield* Ref.make<Options[]>([])
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo", { kilocodeOrganizationId: "org-a" })
        yield* cache.fetch("kilo", { kilocodeOrganizationId: "org-b" })
        expect((yield* Ref.get(calls)).length).toBe(2)

        yield* cache.clear("kilo")
        expect(yield* cache.get("kilo", { kilocodeOrganizationId: "org-a" })).toBeUndefined()
        expect(yield* cache.get("kilo", { kilocodeOrganizationId: "org-b" })).toBeUndefined()

        yield* cache.fetch("kilo", { kilocodeOrganizationId: "org-a" })
        expect((yield* Ref.get(calls)).length).toBe(3)
      }),
    ).pipe(Effect.provide(layer(info, calls)))
  }),
)

it.live("in-flight requests coalesce per identity, not per provider", () =>
  Effect.gen(function* () {
    const info = yield* Ref.make<Auth.Info | undefined>(oauth("token-shared", "org-a"))
    const calls = yield* Ref.make<Options[]>([])
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const same = yield* Effect.all(
          [
            cache.fetch("kilo", { kilocodeOrganizationId: "org-a" }),
            cache.fetch("kilo", { kilocodeOrganizationId: "org-a" }),
          ],
          { concurrency: "unbounded" },
        )
        expect(same[0]).toEqual(same[1])
        expect((yield* Ref.get(calls)).length).toBe(1)
      }),
    ).pipe(Effect.provide(layer(info, calls)))
  }),
)
