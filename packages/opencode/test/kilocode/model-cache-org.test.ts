// Regression test: OAuth accountId must flow into model fetch as kilocodeOrganizationId
// When a user logs in via OAuth and selects an enterprise organization, the model fetch
// should use the organization-specific endpoint, not the personal endpoint.

import { expect, spyOn } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

import { Auth } from "../../src/auth"
import { recommend } from "../../src/kilocode/provider/catalog"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

type Options = Parameters<ModelCache.KiloModels["fetch"]>[0]

function layer(
  info: Auth.Info | undefined,
  captured: Ref.Ref<Options | undefined>,
  options: Record<string, string> = {},
) {
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
    Layer.provide(TestConfig.layer({ get: () => Effect.succeed({ provider: { kilo: { options } } }) })),
    Layer.provide(auth),
    Layer.provide(models),
  )
}

const it = testEffect(Layer.empty)

function environment(values: Record<string, string | undefined>) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key]
        if (value !== undefined) process.env[key] = value
      }
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          if (value !== undefined) process.env[key] = value
        }
      }),
  )
}

for (const org of [false, true]) {
  for (const item of [
    { name: "environment", auth: "oauth", key: "env-token", env: "org-env", token: "env-token", org: "org-env" },
    { name: "OAuth", auth: "oauth", key: undefined, env: undefined, token: "stored-token", org: "org-stored" },
    { name: "API", auth: "api", key: undefined, env: undefined, token: "stored-token", org: "org-config" },
    { name: "configured", auth: "none", key: undefined, env: undefined, token: "configured-token", org: "org-config" },
    {
      name: "Kilo token",
      auth: "none",
      key: undefined,
      env: undefined,
      token: "configured-kilo-token",
      org: "org-config",
    },
    { name: "empty Kilo token", auth: "none", key: undefined, env: undefined, token: "", org: "org-config" },
    { name: "empty environment", auth: "oauth", key: "", env: "", token: "stored-token", org: "org-stored" },
    { name: "empty stored token", auth: "empty", key: undefined, env: undefined, token: "", org: "org-stored" },
  ]) {
    it.live(`catalog and default requests share ${item.name} credentials (Org: ${org})`, () =>
      Effect.gen(function* () {
        yield* environment({ KILO_API_KEY: item.key, KILO_ORG_ID: org ? item.env : undefined })
        const captured = yield* Ref.make<Options | undefined>(undefined)
        const info =
          item.auth === "api"
            ? new Auth.Api({ type: "api", key: "stored-token" })
            : item.auth === "none"
              ? undefined
              : new Auth.Oauth({
                  type: "oauth",
                  access: item.auth === "empty" ? "" : "stored-token",
                  refresh: "stored-refresh",
                  expires: 0,
                  ...(org ? { accountId: "org-stored" } : {}),
                })
        const options = {
          apiKey: "configured-token",
          ...(["Kilo token", "empty Kilo token"].includes(item.name) ? { kilocodeToken: item.token } : {}),
          ...(org ? { kilocodeOrganizationId: "org-config" } : {}),
        }
        const requests: Array<{ path: string; authorization: string | null }> = []
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const original = globalThis.fetch
            return spyOn(globalThis, "fetch").mockImplementation(
              Object.assign(
                async (input: RequestInfo | URL, init?: RequestInit) => {
                  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
                  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
                  requests.push({ path: url.pathname, authorization: headers.get("authorization") })
                  return Response.json({ defaultModel: "selected", defaultFreeModel: "free" })
                },
                { preconnect: original.preconnect },
              ),
            )
          }),
          (fetch) => Effect.sync(() => fetch.mockRestore()),
        )
        yield* ModelCache.Service.use((cache) => cache.fetch("kilo")).pipe(
          Effect.provide(layer(info, captured, options)),
        )
        expect((yield* Ref.get(captured))?.kilocodeToken).toBe(item.token)
        expect((yield* Ref.get(captured))?.kilocodeOrganizationId).toBe(org ? item.org : undefined)
        expect(yield* Effect.promise(() => recommend({ first: {}, selected: {}, free: {} }, options, info))).toBe(
          item.token ? "selected" : "free",
        )
        expect(requests).toEqual([
          {
            path: org ? `/api/organizations/${item.org}/defaults` : "/api/defaults",
            authorization: item.token ? `Bearer ${item.token}` : null,
          },
        ])
      }),
    )
  }
}

it.live("anonymous Personal defaults do not borrow a configured or stored credential", () =>
  Effect.gen(function* () {
    yield* environment({ KILO_API_KEY: undefined, KILO_ORG_ID: undefined })
    const requests: Array<string | null> = []
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const original = globalThis.fetch
        return spyOn(globalThis, "fetch").mockImplementation(
          Object.assign(
            async (_input: RequestInfo | URL, init?: RequestInit) => {
              requests.push(new Headers(init?.headers).get("authorization"))
              return Response.json({ defaultModel: "selected", defaultFreeModel: "free" })
            },
            { preconnect: original.preconnect },
          ),
        )
      }),
      (fetch) => Effect.sync(() => fetch.mockRestore()),
    )
    expect(yield* Effect.promise(() => recommend({ selected: {}, free: {} }, undefined, undefined))).toBe("free")
    expect(requests).toEqual([null])
  }),
)

it.live("explicit fetch credentials override environment values, including explicit clearing", () =>
  Effect.gen(function* () {
    yield* environment({ KILO_API_KEY: "env-token", KILO_ORG_ID: "org-env" })
    const captured = yield* Ref.make<Options | undefined>(undefined)
    const info = new Auth.Oauth({
      type: "oauth",
      access: "stored-token",
      refresh: "refresh",
      expires: 0,
      accountId: "org-stored",
    })
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo", { kilocodeToken: "explicit-token", kilocodeOrganizationId: "org-explicit" })
        expect(yield* Ref.get(captured)).toMatchObject({
          kilocodeToken: "explicit-token",
          kilocodeOrganizationId: "org-explicit",
        })
        yield* cache.refresh("kilo", { kilocodeToken: undefined, kilocodeOrganizationId: undefined })
        expect((yield* Ref.get(captured))?.kilocodeToken).toBeUndefined()
        expect((yield* Ref.get(captured))?.kilocodeOrganizationId).toBeUndefined()
        yield* cache.refresh("kilo", { kilocodeToken: "", kilocodeOrganizationId: "" })
        expect((yield* Ref.get(captured))?.kilocodeToken).toBe("")
        expect((yield* Ref.get(captured))?.kilocodeOrganizationId).toBe("")
      }),
    ).pipe(Effect.provide(layer(info, captured, { apiKey: "configured-token", kilocodeOrganizationId: "org-config" })))
  }),
)

it.live("rejects a model endpoint whose pinned Org conflicts with the selected environment Org", () =>
  Effect.gen(function* () {
    yield* environment({ KILO_API_KEY: "env-token", KILO_ORG_ID: "org-env" })
    const captured = yield* Ref.make<Options | undefined>(undefined)
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        expect(yield* cache.fetch("kilo", { baseURL: "https://gateway.test/api/organizations/org-pinned" })).toEqual({})
        expect(yield* cache.getFailure("kilo")).toEqual({ kind: "schema" })
        expect(yield* Ref.get(captured)).toBeUndefined()
      }),
    ).pipe(Effect.provide(layer(undefined, captured)))
  }),
)

for (const source of ["configured", "token", "personal", "conflict"] as const) {
  it.live(`does not send ${source} transport credentials to a different defaults service`, () =>
    Effect.gen(function* () {
      yield* environment({ KILO_API_KEY: undefined, KILO_ORG_ID: source === "conflict" ? "org-env" : undefined })
      const url =
        source === "personal"
          ? "https://gateway.test/api/openrouter"
          : "https://gateway.test/api/organizations/org-pinned"
      const info = source === "token" ? new Auth.Api({ type: "api", key: `${url}:private-token` }) : undefined
      const options = source === "token" ? undefined : { apiKey: "private-token", baseURL: url }
      const fetch = yield* Effect.acquireRelease(
        Effect.sync(() => spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected defaults request"))),
        (fetch) => Effect.sync(() => fetch.mockRestore()),
      )
      expect(yield* Effect.promise(() => recommend({ first: {}, selected: {} }, options, info))).toBe(
        source === "personal" || source === "conflict" ? undefined : "first",
      )
      expect(fetch).not.toHaveBeenCalled()
    }),
  )
}

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
