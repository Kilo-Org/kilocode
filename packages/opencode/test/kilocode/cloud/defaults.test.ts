import { expect } from "bun:test"
import { Effect, Layer, Redacted, Ref } from "effect"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { CloudAuth } from "@/kilocode/cloud/auth"
import { CloudCatalog } from "@/kilocode/cloud/catalog"
import { CloudDefaults } from "@/kilocode/cloud/defaults"
import { MAX_CLOUD_AGENT_RESPONSE_BYTES } from "@/kilocode/cloud/response-json"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer))

type RequestInfo = {
  readonly authorization: string | null
  readonly feature: string | null
  readonly organization: string | null
  readonly path: string
}

const oauth = (token: string, organizationID: string) =>
  new Auth.Oauth({
    type: "oauth",
    access: token,
    refresh: "test-refresh",
    expires: Date.now() + 60_000,
    accountId: organizationID,
  })

const authLayer = (info: Auth.Info) =>
  Layer.mock(Auth.Service)({
    get: (id) => Effect.succeed(id === "kilo" ? info : undefined),
  })

const stateLayer = (state: CloudDefaults.ModelStateInfo) =>
  Layer.mock(CloudDefaults.ModelState)({
    get: () => Effect.succeed(state),
  })

const state = (input: Partial<CloudDefaults.ModelStateInfo> = {}): CloudDefaults.ModelStateInfo => ({
  model: {},
  recent: [],
  favorite: [],
  variant: {},
  ...input,
})

function withCatalog<A, E, R>(
  models: readonly string[],
  defaultModel: string,
  use: (url: URL, requests: RequestInfo[]) => Effect.Effect<A, E, R>,
) {
  const requests: RequestInfo[] = []
  return Effect.acquireUseRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          const url = new URL(request.url)
          requests.push({
            authorization: request.headers.get("authorization"),
            feature: request.headers.get("x-kilocode-feature"),
            organization: request.headers.get("x-kilocode-organizationid"),
            path: url.pathname,
          })
          if (url.pathname.endsWith("/models")) {
            return Response.json({ data: models.map((id) => ({ id, supported_parameters: ["tools"] })) })
          }
          if (url.pathname.endsWith("/defaults")) return Response.json({ defaultModel })
          return new Response(null, { status: 404 })
        },
      }),
    ),
    (server) => use(server.url, requests),
    (server) => Effect.promise(() => server.stop(true)),
  )
}

it.instance("routes URL-scoped credentials to their catalog origin", () => {
  const token = "https://catalog.example.test:scoped-token"
  const requests: RequestInfo[] = []
  return Effect.gen(function* () {
    const catalog = yield* CloudCatalog.Service

    expect(yield* catalog.models({ token: Redacted.make(token) })).toEqual(["anthropic/scoped"])
    expect(requests).toEqual([
      {
        authorization: `Bearer ${token}`,
        feature: "kilo-cli",
        organization: null,
        path: "/api/openrouter/models",
      },
    ])
  }).pipe(
    Effect.provide(
      CloudCatalog.layer({
        env: {},
        fetch: async (request) => {
          const url = new URL(request.url)
          expect(url.origin).toBe("https://catalog.example.test")
          requests.push({
            authorization: request.headers.get("authorization"),
            feature: request.headers.get("x-kilocode-feature"),
            organization: request.headers.get("x-kilocode-organizationid"),
            path: url.pathname,
          })
          return Response.json({ data: [{ id: "anthropic/scoped", supported_parameters: ["tools"] }] })
        },
      }),
    ),
  )
})

it.instance("returns only tool-capable text-output models", () =>
  Effect.gen(function* () {
    const catalog = yield* CloudCatalog.Service
    const models = yield* catalog.models({ token: Redacted.make("stored-token") })
    expect(models).toEqual(["anthropic/code"])
  }).pipe(
    Effect.provide(
      CloudCatalog.layer({
        fetch: async () =>
          Response.json({
            data: [
              {
                id: "anthropic/code",
                architecture: { output_modalities: ["text"] },
                supported_parameters: ["tools"],
              },
              {
                id: "image/generator",
                architecture: { output_modalities: ["image"] },
                supported_parameters: ["tools"],
              },
              {
                id: "anthropic/chat",
                architecture: { output_modalities: ["text"] },
                supported_parameters: ["temperature"],
              },
              { id: "anthropic/unknown" },
            ],
          }),
      }),
    ),
  ),
)

it.instance("rejects oversized catalog responses", () =>
  Effect.gen(function* () {
    const catalog = yield* CloudCatalog.Service
    const error = yield* catalog.models({ token: Redacted.make("stored-token") }).pipe(Effect.flip)
    expect(error).toMatchObject({ _tag: "CloudCatalogError", kind: "schema" })
  }).pipe(
    Effect.provide(
      CloudCatalog.layer({
        fetch: async () =>
          Response.json({ data: [] }, { headers: { "content-length": String(MAX_CLOUD_AGENT_RESPONSE_BYTES + 1) } }),
      }),
    ),
  ),
)

it.instance(
  "explicit overrides beat environment and saved defaults without persisting",
  () =>
    withCatalog(["anthropic/explicit", "anthropic/default"], "anthropic/default", (url, requests) =>
      Effect.gen(function* () {
        const savedID = "22222222-2222-4222-8222-222222222222"
        const envID = "33333333-3333-4333-8333-333333333333"
        const explicitID = "44444444-4444-4444-8444-444444444444"
        const stored = oauth("stored-token", savedID)
        const current = yield* Ref.make<Auth.Info>(stored)
        const auth = Layer.mock(Auth.Service)({
          get: (id) => (id === "kilo" ? Ref.get(current) : Effect.succeed(undefined)),
          set: (id, info) => (id === "kilo" ? Ref.set(current, info) : Effect.void),
        })

        const resolved = yield* Effect.gen(function* () {
          const result = yield* CloudDefaults.resolve({
            mode: "debug",
            model: "kilo/anthropic/explicit",
            orgID: explicitID,
            env: {
              KILO_API_KEY: "ignored-env-token",
              KILO_ORG_ID: envID,
            },
          })
          const service = yield* Auth.Service
          expect(yield* service.get("kilo")).toEqual(stored)
          return result
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              auth,
              stateLayer(
                state({
                  model: { debug: { providerID: "kilo", modelID: "anthropic/saved" } },
                }),
              ),
              CloudCatalog.layer({ env: { KILO_API_URL: url.origin } }),
            ),
          ),
        )

        expect(resolved).toMatchObject({
          mode: "debug",
          model: "anthropic/explicit",
          organizationID: explicitID,
        })
        expect(requests.map((request) => request.path)).toEqual([`/api/organizations/${explicitID}/models`])
        expect(
          requests.every(
            (request) =>
              request.path.startsWith(`/api/organizations/${explicitID}/`) &&
              request.authorization === "Bearer stored-token" &&
              request.feature === "kilo-cli" &&
              request.organization === explicitID,
          ),
        ).toBe(true)
      }),
    ),
  {
    config: {
      default_agent: "plan",
      model: "kilo/anthropic/repository",
      agent: { plan: { model: "kilo/anthropic/mode" } },
    },
  },
)

it.instance(
  "skips a stale saved model and uses the available repository model",
  () =>
    withCatalog(
      ["anthropic/repository", "anthropic/recent", "anthropic/default"],
      "anthropic/default",
      (url, requests) =>
        Effect.gen(function* () {
          const resolved = yield* CloudDefaults.resolve()
          expect(resolved.mode).toBe("code")
          expect(resolved.model).toBe("anthropic/repository")
          expect(requests.map((request) => request.path)).toEqual(["/api/openrouter/models"])
          expect(requests.every((request) => request.organization === null)).toBe(true)
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              authLayer(new Auth.Api({ type: "api", key: "stored-api-token" })),
              stateLayer(
                state({
                  model: { code: { providerID: "kilo", modelID: "anthropic/stale" } },
                  recent: [{ providerID: "kilo", modelID: "anthropic/recent" }],
                }),
              ),
              CloudCatalog.layer({ env: { KILO_API_URL: url.origin } }),
            ),
          ),
        ),
    ),
  {
    config: {
      model: "kilo/anthropic/repository",
      agent: { code: { model: null } },
    },
  },
)

it.instance(
  "uses the saved model for the resolved mode when it remains available",
  () =>
    withCatalog(["anthropic/saved", "anthropic/default"], "anthropic/default", (url) =>
      CloudDefaults.resolve().pipe(
        Effect.tap((resolved) =>
          Effect.sync(() => {
            expect(resolved.mode).toBe("code")
            expect(resolved.model).toBe("anthropic/saved")
          }),
        ),
        Effect.provide(
          Layer.mergeAll(
            authLayer(new Auth.Api({ type: "api", key: "stored-api-token" })),
            stateLayer(
              state({
                model: { code: { providerID: "kilo", modelID: "anthropic/saved" } },
              }),
            ),
            CloudCatalog.layer({ env: { KILO_API_URL: url.origin } }),
          ),
        ),
      ),
    ),
  {
    config: { agent: { code: { model: null } } },
  },
)

it.instance(
  "fetches the catalog default only when configured and saved candidates are unavailable",
  () =>
    withCatalog(["anthropic/default"], "anthropic/default", (url, requests) =>
      CloudDefaults.resolve().pipe(
        Effect.tap((resolved) =>
          Effect.sync(() => {
            expect(resolved.model).toBe("anthropic/default")
            expect(requests.map((request) => request.path)).toEqual(["/api/openrouter/models", "/api/defaults"])
          }),
        ),
        Effect.provide(
          Layer.mergeAll(
            authLayer(new Auth.Api({ type: "api", key: "stored-api-token" })),
            stateLayer(state()),
            CloudCatalog.layer({ env: { KILO_API_URL: url.origin } }),
          ),
        ),
      ),
    ),
  {
    config: { agent: { code: { model: null } } },
  },
)

it.instance(
  "falls back from an inferred custom mode but rejects an explicit custom mode",
  () =>
    withCatalog(["anthropic/code", "anthropic/custom", "anthropic/default"], "anthropic/default", (url, requests) =>
      Effect.gen(function* () {
        const inferred = yield* CloudDefaults.resolve()
        expect(inferred.mode).toBe("code")
        expect(inferred.model).toBe("anthropic/code")

        const error = yield* CloudDefaults.resolve({ mode: "custom" }).pipe(Effect.flip)
        expect(error).toMatchObject({
          _tag: "CloudDefaultsResolutionError",
          kind: "mode",
        })
        expect(requests).toHaveLength(1)
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            authLayer(new Auth.Api({ type: "api", key: "stored-api-token" })),
            stateLayer(state()),
            CloudCatalog.layer({ env: { KILO_API_URL: url.origin } }),
          ),
        ),
      ),
    ),
  {
    config: {
      default_agent: "custom",
      agent: {
        code: { model: "kilo/anthropic/code" },
        custom: { mode: "primary", model: "kilo/anthropic/custom" },
      },
    },
  },
)

it.instance("rejects invalid persisted organization state and insecure catalog origins", () =>
  Effect.gen(function* () {
    const invalid = authLayer(oauth("stored-token", "not-a-uuid"))
    const token = yield* CloudAuth.token().pipe(Effect.provide(invalid))
    expect(Redacted.value(token)).toBe("stored-token")

    const org = yield* CloudAuth.resolve().pipe(Effect.provide(invalid), Effect.flip)
    expect(org).toMatchObject({
      _tag: "CloudAuthResolutionError",
      kind: "organization",
    })

    const catalog = yield* CloudDefaults.resolve({ env: { KILO_API_URL: "http://example.com" } }).pipe(
      Effect.provide(
        Layer.mergeAll(
          authLayer(new Auth.Api({ type: "api", key: "stored-api-token" })),
          stateLayer(state()),
          CloudCatalog.layer({
            env: { KILO_API_URL: "http://example.com" },
            fetch: () => Promise.reject(new Error("insecure catalog request must not run")),
          }),
        ),
      ),
      Effect.flip,
    )
    expect(catalog).toMatchObject({
      _tag: "CloudCatalogError",
      kind: "schema",
    })
  }),
)

it.instance(
  "uses stored auth and the resolved mode model before lower-precedence defaults",
  () =>
    withCatalog(
      ["anthropic/mode", "anthropic/saved", "anthropic/repository", "anthropic/recent", "anthropic/default"],
      "anthropic/default",
      (url, requests) =>
        Effect.gen(function* () {
          const organizationID = "11111111-1111-4111-8111-111111111111"
          const resolved = yield* CloudDefaults.resolve({
            env: { KILO_API_KEY: "ignored-env-token" },
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                authLayer(oauth("stored-token", organizationID)),
                stateLayer(
                  state({
                    model: { plan: { providerID: "kilo", modelID: "anthropic/saved" } },
                    recent: [{ providerID: "kilo", modelID: "anthropic/recent" }],
                  }),
                ),
                CloudCatalog.layer({ env: { KILO_API_URL: url.origin } }),
              ),
            ),
          )

          expect(resolved).toMatchObject({
            mode: "plan",
            model: "anthropic/mode",
            organizationID,
          })
          expect(requests.map((request) => request.path)).toEqual([`/api/organizations/${organizationID}/models`])
          expect(
            requests.every(
              (request) => request.authorization === "Bearer stored-token" && request.organization === organizationID,
            ),
          ).toBe(true)
        }),
    ),
  {
    config: {
      default_agent: "plan",
      model: "kilo/anthropic/repository",
      agent: { plan: { model: "kilo/anthropic/mode" } },
    },
  },
)
