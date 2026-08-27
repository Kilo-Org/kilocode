import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import path from "node:path"
import { Catalog } from "../src/catalog"
import { Credential } from "../src/credential"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Global } from "../src/global"
import { Integration } from "../src/integration"
import { ProviderUsage } from "../src/kilocode/provider-usage"
import { decode, load, normalize } from "../src/kilocode/provider-usage/codex"
import { Location } from "../src/location"
import { PluginV2 } from "../src/plugin"
import { ProviderV2 } from "../src/provider"
import { AbsolutePath } from "../src/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const openai = Integration.ID.make("openai")
const minimax = Integration.ID.make("minimax-coding-plan")
const method = Integration.MethodID.make("chatgpt-browser")
const it = testEffect(Layer.empty)

type RequestHandler = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type Fixture = {
  usage: ProviderUsage.Interface
  catalog: Catalog.Interface
  integrations: Integration.Interface
  credentials: Credential.Interface
  requests: Array<{ url: string; init: RequestInit }>
  refreshes: { count: number }
}

const window = (used: number, seconds = 18_000) => ({
  used_percent: used,
  limit_window_seconds: seconds,
  reset_after_seconds: seconds,
  reset_at: Math.floor(Date.now() / 1000) + seconds,
})

const payload = (overrides: Record<string, unknown> = {}) => ({
  plan_type: "plus",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: window(20),
    secondary_window: window(35, 604_800),
  },
  additional_rate_limits: [],
  ...overrides,
})

const native = (remaining: number) =>
  Response.json({
    base_resp: { status_code: 0 },
    model_remains: [
      {
        model_name: "general",
        current_interval_remaining_percent: remaining,
        current_interval_status: 1,
      },
    ],
  })

const fixture = <A, E, R>(
  handler: RequestHandler,
  body: (value: Fixture) => Effect.Effect<A, E, R>,
  opts: { minimax?: boolean; failure?: () => boolean } = {},
) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((dir) => {
      const requests: Fixture["requests"] = []
      const refreshes = { count: 0 }
      const transport = Layer.succeed(ProviderUsage.Transport, {
        fetch: Object.assign(
          (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
            requests.push({ url, init: init ?? {} })
            return handler(input, init)
          },
          { preconnect: fetch.preconnect },
        ),
        plans: async () => [],
        byok: async () => [],
        usage: async () => {
          throw new Error("Unexpected managed usage request")
        },
      })
      const layer = AppNodeBuilder.build(
        LayerNode.group([ProviderUsage.node, Catalog.node, Integration.node, Credential.node, PluginV2.node]),
        [
          [
            Global.node,
            Global.layerWith({
              home: dir.path,
              data: dir.path,
              cache: dir.path,
              config: dir.path,
              state: dir.path,
              tmp: dir.path,
              bin: dir.path,
              log: dir.path,
              repos: dir.path,
            }),
          ],
          [Database.node, Database.layerFromPath(path.join(dir.path, "provider-usage.sqlite"))],
          [
            Location.node,
            Layer.succeed(
              Location.Service,
              Location.Service.of(location(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))),
            ),
          ],
          [ProviderUsage.transportNode, transport],
        ],
      )

      return Effect.gen(function* () {
        const plugins = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        const integrations = yield* Integration.Service
        const credentials = yield* Credential.Service
        const usage = yield* ProviderUsage.Service

        yield* plugins.add(PluginV2.ID.make("config-provider"), (host) =>
          Effect.gen(function* () {
            yield* host.integration.transform((draft) => {
              draft.method.update({
                integrationID: openai,
                method: { id: method, type: "oauth", label: "ChatGPT" },
                authorize: () => Effect.die("Unexpected OAuth authorization"),
                refresh: (value) =>
                  Effect.suspend(() => {
                    refreshes.count++
                    if (opts.failure?.()) return Effect.fail(new Error("private OAuth refresh failure"))
                    return Effect.succeed(
                      Credential.OAuth.make({
                        ...value,
                        methodID: method,
                        access: "refreshed-access-token",
                        refresh: "rotated-refresh-token",
                        expires: Date.now() + 3_600_000,
                      }),
                    )
                  }),
              })
              draft.method.update({
                integrationID: openai,
                method: { type: "key", label: "API key" },
              })
              if (opts.minimax)
                draft.method.update({
                  integrationID: minimax,
                  method: { type: "key", label: "MiniMax API key" },
                })
            })
            yield* host.catalog.transform((draft) => {
              draft.provider.update(openai, (provider) => {
                provider.name = "OpenAI"
                provider.integrationID = openai
              })
              if (opts.minimax)
                draft.provider.update(minimax, (provider) => {
                  provider.name = "MiniMax Global"
                  provider.integrationID = minimax
                })
            })
          }),
        )

        return yield* body({ usage, catalog, integrations, credentials, requests, refreshes })
      }).pipe(Effect.provide(layer))
    }),
  )

const connect = Effect.fn("CodexProviderUsageTest.connect")(function* (
  credentials: Credential.Interface,
  input: { access?: string; account?: string; expires?: number } = {},
) {
  return yield* credentials.create({
    integrationID: openai,
    label: input.account ?? "Personal",
    value: Credential.OAuth.make({
      type: "oauth",
      methodID: method,
      access: input.access ?? "codex-access-token",
      refresh: "codex-refresh-token",
      expires: input.expires ?? Date.now() + 3_600_000,
      metadata: input.account ? { accountID: input.account } : undefined,
    }),
  })
})

describe("Codex provider usage service", () => {
  it.live("uses OAuth bearer and account headers with bounded direct transport settings", () =>
    fixture(
      async () => Response.json(payload()),
      ({ usage, credentials, requests }) =>
        Effect.gen(function* () {
          yield* connect(credentials, { account: "acct-personal" })
          const result = yield* usage.get()
          const headers = new Headers(requests[0]?.init.headers)

          expect(requests).toHaveLength(1)
          expect(requests[0]?.url).toBe("https://chatgpt.com/backend-api/wham/usage")
          expect(requests[0]?.init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" })
          expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal)
          expect(headers.get("authorization")).toBe("Bearer codex-access-token")
          expect(headers.get("chatgpt-account-id")).toBe("acct-personal")
          expect(result.items).toHaveLength(1)
          expect(result.items[0]).toMatchObject({
            id: "codex-chatgpt",
            providerID: "openai",
            sourceKind: "direct",
            fetchState: "ready",
            planState: "active",
            routingState: "not_applicable",
            windows: [
              {
                orientation: "used_percent",
                unit: "percent",
                used: 20,
                remaining: 80,
                limit: 100,
                durationMs: 18_000_000,
                period: { unit: "hour", value: 5 },
                state: "active",
              },
              {
                orientation: "used_percent",
                used: 35,
                remaining: 65,
                durationMs: 604_800_000,
                period: { unit: "week", value: 1 },
              },
            ],
          })
          expect(JSON.stringify(result)).not.toContain("codex-access-token")
          expect(JSON.stringify(result)).not.toContain("acct-personal")
        }),
    ),
  )

  it.live("omits the account header and accepts a successful response without windows", () =>
    fixture(
      async () => Response.json(payload({ rate_limit: null })),
      ({ usage, credentials, requests }) =>
        Effect.gen(function* () {
          yield* connect(credentials)
          const result = yield* usage.get()

          expect(new Headers(requests[0]?.init.headers).has("chatgpt-account-id")).toBe(false)
          expect(result.items[0]).toMatchObject({ id: "codex-chatgpt", fetchState: "ready", windows: [] })
        }),
    ),
  )

  it.live("refreshes expired OAuth credentials through the registered implementation and persists them", () =>
    fixture(
      async () => Response.json(payload()),
      ({ usage, credentials, requests, refreshes }) =>
        Effect.gen(function* () {
          const saved = yield* connect(credentials, { account: "acct-refresh", expires: Date.now() - 1 })
          const result = yield* usage.get()
          const stored = yield* credentials.get(saved.id)
          const headers = new Headers(requests[0]?.init.headers)

          expect(result.items[0]?.fetchState).toBe("ready")
          expect(refreshes.count).toBe(1)
          expect(headers.get("authorization")).toBe("Bearer refreshed-access-token")
          expect(headers.get("chatgpt-account-id")).toBe("acct-refresh")
          expect(stored?.value).toMatchObject({
            type: "oauth",
            access: "refreshed-access-token",
            refresh: "rotated-refresh-token",
            metadata: { accountID: "acct-refresh" },
          })
          expect((yield* usage.get()).items[0]?.fetchState).toBe("ready")
          expect(refreshes.count).toBe(1)
          expect(requests).toHaveLength(1)
        }),
    ),
  )

  it.live("preserves transient refresh failures only for the same active credential", () => {
    const failure = { current: false }
    return fixture(
      async () => Response.json(payload()),
      ({ usage, credentials, requests, refreshes }) =>
        Effect.gen(function* () {
          const saved = yield* connect(credentials, { account: "acct-original" })
          const ready = (yield* usage.get()).items[0]
          expect(ready?.fetchState).toBe("ready")
          expect(ready?.windows[0]?.used).toBe(20)

          yield* credentials.update(saved.id, {
            value: Credential.OAuth.make({
              type: "oauth",
              methodID: method,
              access: "codex-access-token",
              refresh: "codex-refresh-token",
              expires: Date.now() - 1,
              metadata: { accountID: "acct-original" },
            }),
          })
          failure.current = true
          const stale = yield* usage.get()

          expect(stale.items[0]?.fetchState).toBe("stale")
          expect(stale.items[0]?.windows[0]?.used).toBe(20)
          expect(JSON.stringify(stale)).not.toContain("private OAuth refresh failure")
          expect(requests).toHaveLength(1)
          expect(refreshes.count).toBe(1)

          yield* connect(credentials, { account: "acct-replacement", expires: Date.now() - 1 })
          expect((yield* usage.get()).items).toEqual([])
          expect(requests).toHaveLength(1)
          expect(refreshes.count).toBe(2)
        }),
      { failure: () => failure.current },
    )
  })

  it.live("invalidates cached usage when an account changes despite reusing its access token", () =>
    fixture(
      async (_input, init) =>
        Response.json(
          payload({
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: window(new Headers(init?.headers).get("chatgpt-account-id") === "acct-first" ? 15 : 75),
            },
          }),
        ),
      ({ usage, credentials, requests }) =>
        Effect.gen(function* () {
          yield* connect(credentials, { access: "shared-access-token", account: "acct-first" })
          expect((yield* usage.get()).items[0]?.windows[0]).toMatchObject({ used: 15 })

          yield* connect(credentials, { access: "shared-access-token", account: "acct-second" })
          expect((yield* usage.get()).items[0]?.windows[0]).toMatchObject({ used: 75 })
          expect(requests).toHaveLength(2)
          expect(new Headers(requests[1]?.init.headers).get("chatgpt-account-id")).toBe("acct-second")
        }),
    ),
  )

  it.live("prevents an old in-flight account request from overwriting its replacement", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const pending: { release?: (response: Response) => void } = {}

      return yield* fixture(
        (input, init) => {
          if (new Headers(init?.headers).get("chatgpt-account-id") === "acct-old") {
            Effect.runSync(Deferred.succeed(started, undefined))
            return new Promise((resolve) => {
              pending.release = resolve
            })
          }
          return Promise.resolve(Response.json(payload({ rate_limit: { allowed: true, primary_window: window(70) } })))
        },
        ({ usage, credentials, requests }) =>
          Effect.gen(function* () {
            yield* connect(credentials, { access: "shared-access-token", account: "acct-old" })
            const first = yield* usage.get().pipe(Effect.forkChild)
            yield* Deferred.await(started).pipe(Effect.timeout("2 seconds"))

            yield* connect(credentials, { access: "shared-access-token", account: "acct-new" })
            const second = yield* usage.get()
            expect(second.items[0]?.windows[0]).toMatchObject({ used: 70 })
            expect(requests).toHaveLength(2)

            pending.release?.(Response.json(payload({ rate_limit: { allowed: true, primary_window: window(10) } })))
            expect((yield* Fiber.join(first)).items).toEqual([])
            expect((yield* usage.get()).items[0]?.windows[0]).toMatchObject({ used: 70 })
            expect(requests).toHaveLength(2)
          }),
      )
    }),
  )

  for (const state of ["disabled", "removed"]) {
    it.live(`prunes cached usage when the OpenAI provider is ${state}`, () =>
      fixture(
        async () => Response.json(payload()),
        ({ usage, catalog, credentials, requests }) =>
          Effect.gen(function* () {
            yield* connect(credentials)
            expect((yield* usage.get()).items).toHaveLength(1)

            yield* catalog.transform((draft) => {
              if (state === "removed") return draft.provider.remove(ProviderV2.ID.openai)
              draft.provider.update(ProviderV2.ID.openai, (provider) => {
                provider.disabled = true
              })
            })
            expect((yield* usage.get()).items).toEqual([])
            expect(requests).toHaveLength(1)
          }),
      ),
    )
  }

  it.live("prunes OAuth usage after API-key takeover and logout", () =>
    fixture(
      async () => Response.json(payload()),
      ({ usage, integrations, credentials, requests }) =>
        Effect.gen(function* () {
          yield* connect(credentials, { account: "acct-key" })
          expect((yield* usage.get()).items).toHaveLength(1)

          yield* integrations.connection.key({ integrationID: openai, key: "private-api-key" })
          expect((yield* usage.get()).items).toEqual([])

          const restored = yield* connect(credentials, { account: "acct-logout" })
          expect((yield* usage.get()).items).toHaveLength(1)
          yield* integrations.connection.remove(restored.id)
          expect((yield* usage.get()).items).toEqual([])
          expect(requests).toHaveLength(2)
        }),
    ),
  )

  it.live("keeps Codex and MiniMax independent when either upstream fails", () =>
    fixture(
      (() => {
        const calls = { codex: 0, minimax: 0 }
        return async (input: string | URL | Request) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
          if (url.includes("chatgpt.com")) {
            calls.codex++
            return calls.codex === 1 ? new Response("private codex failure", { status: 503 }) : Response.json(payload())
          }
          calls.minimax++
          return calls.minimax === 1 ? native(80) : new Response("private minimax failure", { status: 503 })
        }
      })(),
      ({ usage, credentials }) =>
        Effect.gen(function* () {
          yield* connect(credentials, { account: "acct-both" })
          yield* credentials.create({
            integrationID: minimax,
            value: Credential.Key.make({ type: "key", key: "sk-cp-minimax-secret" }),
          })

          const first = yield* usage.get()
          expect(first.items.find((item) => item.id === "codex-chatgpt")).toMatchObject({
            fetchState: "unavailable",
            windows: [],
          })
          expect(first.items.find((item) => item.id === "minimax-direct-global")).toMatchObject({
            fetchState: "ready",
            windows: [{ remaining: 80 }],
          })

          const second = yield* usage.refresh()
          expect(second.items.find((item) => item.id === "codex-chatgpt")).toMatchObject({ fetchState: "ready" })
          expect(second.items.find((item) => item.id === "minimax-direct-global")).toMatchObject({
            fetchState: "stale",
            windows: [{ remaining: 80 }],
          })
          expect(JSON.stringify([first, second])).not.toContain("private")
          expect(JSON.stringify([first, second])).not.toContain("sk-cp-minimax-secret")
        }),
      { minimax: true },
    ),
  )

  for (const status of [401, 403, 503]) {
    it.live(`handles HTTP ${status} without exposing private upstream errors or invalid quota`, () => {
      const responses = [Response.json(payload()), new Response("private upstream secret", { status })]
      return fixture(
        async () => responses.shift()!,
        ({ usage, credentials }) =>
          Effect.gen(function* () {
            yield* connect(credentials, { account: "acct-errors" })
            const ready = yield* usage.get()
            const failed = yield* usage.refresh()
            const item = failed.items[0]

            expect(ready.items[0]).toMatchObject({ fetchState: "ready", windows: [{ used: 20 }, { used: 35 }] })
            expect(item).toMatchObject({
              id: "codex-chatgpt",
              fetchState: status === 503 ? "stale" : "unavailable",
              error: { retryable: status === 503 },
            })
            expect(item?.windows).toHaveLength(status === 503 ? 2 : 0)
            expect(JSON.stringify(failed)).not.toContain("private upstream secret")
            expect(JSON.stringify(failed)).not.toContain("codex-access-token")
          }),
      )
    })
  }
})

describe("Codex usage normalization", () => {
  test("preserves valid sibling windows when adjacent native windows are malformed", () => {
    const value = decode(
      payload({
        rate_limit: {
          allowed: true,
          primary_window: { ...window(20), used_percent: "invalid private usage" },
          secondary_window: window(45, 86_400),
        },
        additional_rate_limits: [
          { limit_name: "Malformed", metered_feature: "bad", rate_limit: "invalid" },
          {
            limit_name: "Spark",
            metered_feature: "spark",
            rate_limit: { allowed: true, primary_window: window(30, 3_600) },
          },
        ],
      }),
    )
    const item = normalize(value)

    expect(item.fetchState).toBe("ready")
    expect(item.windows).toHaveLength(2)
    expect(item.windows.map((entry) => entry.used)).toEqual([45, 30])
    expect(item.windows[0]).toMatchObject({ durationMs: 86_400_000, period: { unit: "day", value: 1 } })
    expect(JSON.stringify(item)).not.toContain("invalid private usage")
  })

  test("clamps percentages, marks exhausted limits, and produces stable unique duplicate slugs", () => {
    const value = decode(
      payload({
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: window(-10),
          secondary_window: window(140, 604_800),
        },
        additional_rate_limits: [
          {
            limit_name: "Spark Fast",
            metered_feature: "spark",
            rate_limit: { allowed: false, limit_reached: true, primary_window: window(25) },
          },
          {
            limit_name: "Spark-Fast",
            metered_feature: "spark",
            rate_limit: { allowed: true, limit_reached: false, primary_window: window(60) },
          },
        ],
      }),
    )
    const first = normalize(value)
    const second = normalize(value)
    const ids = first.windows.map((entry) => entry.id)

    expect(first.fetchState).toBe("ready")
    expect(first.windows).toHaveLength(4)
    expect(first.windows[0]).toMatchObject({ used: 0, remaining: 100, state: "active" })
    expect(first.windows[1]).toMatchObject({ used: 100, remaining: 0, state: "exhausted" })
    expect(first.windows[2]).toMatchObject({ used: 100, remaining: 0, state: "exhausted" })
    expect(first.windows[3]).toMatchObject({ used: 60, remaining: 40, state: "active" })
    expect(new Set(ids).size).toBe(ids.length)
    expect(second.windows.map((entry) => entry.id)).toEqual(ids)
  })

  test("retains non-round durations without fabricating a named period", () => {
    const value = decode(
      payload({
        rate_limit: {
          allowed: true,
          primary_window: window(20, 5_400),
          secondary_window: window(40, 172_800),
        },
      }),
    )
    const item = normalize(value)

    expect(item.windows[0]).toMatchObject({ durationMs: 5_400_000 })
    expect(item.windows[0]?.period).toBeUndefined()
    expect(item.windows[1]).toMatchObject({ durationMs: 172_800_000, period: { unit: "day", value: 2 } })
  })

  test("falls back from overflowing timestamps and rejects overflowing fallback durations", () => {
    const value = decode(
      payload({
        rate_limit: {
          allowed: true,
          primary_window: { ...window(20), reset_at: Number.MAX_SAFE_INTEGER, reset_after_seconds: 3_600 },
          secondary_window: { ...window(30), reset_at: -1, reset_after_seconds: Number.MAX_SAFE_INTEGER },
        },
      }),
    )
    const item = normalize(value)

    expect(item.fetchState).toBe("ready")
    expect(item.windows[0]?.resetAt).toBe(new Date(Date.parse(item.fetchedAt!) + 3_600_000).toISOString())
    expect(item.windows[1]?.resetAt).toBeUndefined()
  })
})

describe("Codex usage transport", () => {
  for (const mode of ["declared", "streamed"]) {
    test(`rejects oversized ${mode} bodies without exposing their contents`, async () => {
      const response = Response.json(
        { private: mode === "declared" ? "secret" : "secret".padEnd(64 * 1024, "x") },
        { headers: mode === "declared" ? { "content-length": String(64 * 1024 + 1) } : undefined },
      )
      const item = await load(
        { label: "OpenAI", access: "codex-access-token" },
        Object.assign(async () => response, { preconnect: fetch.preconnect }),
      )

      expect(item).toMatchObject({ id: "codex-chatgpt", fetchState: "unavailable", windows: [] })
      expect(JSON.stringify(item)).not.toContain("secret")
    })
  }
})
