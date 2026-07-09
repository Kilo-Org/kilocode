import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { Auth } from "@/auth"
import { ProviderUsage } from "@/kilocode/provider-usage"
import { Provider } from "@/provider/provider"
import { ProviderID } from "@/provider/schema"
import { ProviderTest } from "../../fake/provider"
import { testEffect } from "../../lib/effect"

const info = (id: "minimax-coding-plan" | "minimax-cn-coding-plan", key: string) => {
  const providerID = ProviderID.make(id)
  return ProviderTest.info(
    {
      id: providerID,
      name: id === "minimax-coding-plan" ? "MiniMax Global" : "MiniMax China",
      key,
      options: {},
    },
    ProviderTest.model({ providerID }),
  )
}

function layer(auth: Auth.Info | undefined, providers: Record<string, Provider.Info>) {
  const access = Layer.mock(Auth.Service)({ get: () => Effect.succeed(auth) })
  const catalog = Layer.mock(Provider.Service)({ list: () => Effect.succeed(providers) })
  return Layer.fresh(ProviderUsage.defaultLayer).pipe(Layer.provide(access), Layer.provide(catalog))
}

const it = testEffect(Layer.empty)

const native = (remaining = 80) =>
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

it.instance("returns empty usage when no source is connected", () =>
  Effect.gen(function* () {
    const usage = yield* ProviderUsage.Service
    const result = yield* usage.get()
    expect(result.items).toEqual([])
    expect(result.kiloBilling).toBeUndefined()
  }).pipe(Effect.provide(layer(undefined, {}))),
)

it.instance("caches normal reads and forces an explicit refresh", () =>
  Effect.gen(function* () {
    const original = global.fetch
    let calls = 0
    global.fetch = (() => {
      calls++
      return Promise.resolve(native(100 - calls))
    }) as unknown as typeof fetch

    const result = yield* Effect.gen(function* () {
      const usage = yield* ProviderUsage.Service
      const first = yield* usage.get()
      const cached = yield* usage.get()
      const refreshed = yield* usage.refresh()
      return { first, cached, refreshed }
    }).pipe(Effect.provide(layer(undefined, { "minimax-coding-plan": info("minimax-coding-plan", "sk-cp-one") })))
    global.fetch = original

    expect(calls).toBe(2)
    expect(result.cached).toEqual(result.first)
    expect(result.refreshed.items[0]?.windows[0]?.remaining).toBe(98)
  }),
)

it.instance("coalesces a forced refresh with an in-flight read", () =>
  Effect.gen(function* () {
    const original = global.fetch
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let calls = 0
    global.fetch = (() => {
      calls++
      return Effect.runPromise(
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
          return native()
        }),
      )
    }) as unknown as typeof fetch

    const output = yield* Effect.gen(function* () {
      const usage = yield* ProviderUsage.Service
      const first = yield* usage.get().pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const second = yield* usage.refresh().pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      return [yield* Fiber.join(first), yield* Fiber.join(second)]
    }).pipe(Effect.provide(layer(undefined, { "minimax-coding-plan": info("minimax-coding-plan", "sk-cp-one") })))
    global.fetch = original

    expect(calls).toBe(1)
    expect(output[1]).toEqual(output[0])
  }),
)

it.instance("preserves the last success as stale after a provider failure", () =>
  Effect.gen(function* () {
    const original = global.fetch
    let calls = 0
    global.fetch = (() =>
      Promise.resolve(
        ++calls === 1 ? native() : new Response("private body", { status: 500 }),
      )) as unknown as typeof fetch

    const output = yield* Effect.gen(function* () {
      const usage = yield* ProviderUsage.Service
      const first = yield* usage.get()
      const stale = yield* usage.refresh()
      return { first, stale }
    }).pipe(Effect.provide(layer(undefined, { "minimax-coding-plan": info("minimax-coding-plan", "sk-cp-one") })))
    global.fetch = original

    expect(output.first.items[0]?.fetchState).toBe("ready")
    expect(output.stale.items[0]).toMatchObject({
      fetchState: "stale",
      error: { code: "direct_minimax_unavailable" },
    })
    expect(output.stale.items[0]?.windows).toEqual(output.first.items[0]?.windows)
    expect(JSON.stringify(output.stale)).not.toContain("private body")
  }),
)

it.instance("removes sources that disappear successfully instead of resurrecting them as stale", () =>
  Effect.gen(function* () {
    const original = global.fetch
    global.fetch = (() => Promise.resolve(native())) as unknown as typeof fetch
    let enabled = true
    const access = Layer.mock(Auth.Service)({ get: () => Effect.succeed(undefined) })
    const catalog = Layer.mock(Provider.Service)({
      list: () => Effect.succeed(enabled ? { "minimax-coding-plan": info("minimax-coding-plan", "sk-cp-one") } : {}),
    })
    const usageLayer = Layer.fresh(ProviderUsage.defaultLayer).pipe(Layer.provide(access), Layer.provide(catalog))

    const output = yield* Effect.gen(function* () {
      const usage = yield* ProviderUsage.Service
      const first = yield* usage.get()
      enabled = false
      const refreshed = yield* usage.refresh()
      return { first, refreshed }
    }).pipe(Effect.provide(usageLayer))
    global.fetch = original

    expect(output.first.items).toHaveLength(1)
    expect(output.refreshed.items).toEqual([])
  }),
)

it.instance("keeps direct provider failures independent", () =>
  Effect.gen(function* () {
    const original = global.fetch
    global.fetch = ((url: string | URL | Request) =>
      Promise.resolve(
        String(url).includes("api.minimax.io") ? new Response("failed", { status: 500 }) : native(),
      )) as unknown as typeof fetch

    const result = yield* ProviderUsage.Service.use((usage) => usage.get()).pipe(
      Effect.provide(
        layer(undefined, {
          "minimax-coding-plan": info("minimax-coding-plan", "sk-cp-global"),
          "minimax-cn-coding-plan": info("minimax-cn-coding-plan", "sk-cp-china"),
        }),
      ),
    )
    global.fetch = original

    expect(result.items.map((item) => item.fetchState)).toEqual(["unavailable", "ready"])
  }),
)

it.instance("loads each personal Cloud procedure once and isolates managed enrichment", () =>
  Effect.gen(function* () {
    const original = global.fetch
    const calls: string[] = []
    const ok = (value: unknown) => Response.json({ result: { data: { json: value } } })
    global.fetch = ((input: string | URL | Request) => {
      const procedure = new URL(String(input)).pathname.split("/").at(-1) ?? ""
      calls.push(procedure)
      const values: Record<string, unknown> = {
        "user.getAutoTopUpPaymentMethod": {
          enabled: true,
          amountCents: 5000,
          thresholdCents: 500,
          paymentMethod: {
            type: "card",
            brand: "visa",
            last4: "4242",
            stripePaymentMethodId: "pm_private",
          },
        },
        "codingPlans.listSubscriptions": [
          {
            id: "plan",
            planId: "minimax-token-plan-plus",
            planName: "Token Plan Plus",
            providerName: "MiniMax",
            providerId: "minimax",
            routeLabel: "MiniMax via Kilo Gateway",
            hasInstalledByokKey: false,
            status: "active",
            billingPeriodDays: 30,
            currentPeriodStart: "2026-06-01T00:00:00.000Z",
            currentPeriodEnd: "2026-07-01T00:00:00.000Z",
            creditRenewalAt: "2026-07-01T00:00:00.000Z",
            cancelAtPeriodEnd: false,
            paymentGraceExpiresAt: null,
            canceledAt: null,
            cancellationReason: null,
            createdAt: "2026-06-01T00:00:00.000Z",
            costKiloCredits: 20,
          },
        ],
        "byok.list": [],
        "codingPlans.getUsage": {
          subscriptionId: "plan",
          providerId: "minimax",
          region: "global",
          fetchedAt: "2026-06-19T00:00:00.000Z",
          native: {
            base_resp: { status_code: 0 },
            model_remains: [{ model_name: "general", current_interval_remaining_percent: 80 }],
          },
        },
      }
      return Promise.resolve(ok(values[procedure]))
    }) as unknown as typeof fetch

    const result = yield* ProviderUsage.Service.use((usage) => usage.get()).pipe(
      Effect.provide(
        layer(
          {
            type: "oauth",
            access: "kilo-private-token",
            refresh: "refresh-private-token",
            expires: Date.now() + 60_000,
          },
          {},
        ),
      ),
    )
    global.fetch = original

    expect(calls).toEqual([
      "user.getAutoTopUpPaymentMethod",
      "codingPlans.listSubscriptions",
      "byok.list",
      "codingPlans.getUsage",
    ])
    expect(result.items.map((item) => item.id)).toEqual(["kilo-managed-minimax:plan"])
    expect(result.items[0]).toMatchObject({ routingState: "missing", fetchState: "ready" })
    expect(result.kiloBilling?.autoTopUp).toMatchObject({ paymentBrand: "visa", paymentLast4: "4242" })
    expect(JSON.stringify(result)).not.toContain("pm_private")
    expect(JSON.stringify(result)).not.toContain("kilo-private-token")
  }),
)

it.instance("hides managed quota when a personal key replaces its routing", () =>
  Effect.gen(function* () {
    const original = global.fetch
    const calls: string[] = []
    const ok = (value: unknown) => Response.json({ result: { data: { json: value } } })
    global.fetch = ((input: string | URL | Request) => {
      const procedure = new URL(String(input)).pathname.split("/").at(-1) ?? ""
      calls.push(procedure)
      const values: Record<string, unknown> = {
        "user.getAutoTopUpPaymentMethod": {
          enabled: false,
          amountCents: 5000,
          thresholdCents: 500,
          paymentMethod: null,
        },
        "codingPlans.listSubscriptions": [
          {
            id: "plan",
            planId: "minimax-token-plan-plus",
            planName: "Token Plan Plus",
            providerName: "MiniMax",
            providerId: "minimax",
            routeLabel: "MiniMax via Kilo Gateway",
            hasInstalledByokKey: false,
            status: "active",
            billingPeriodDays: 30,
            currentPeriodStart: "2026-06-01T00:00:00.000Z",
            currentPeriodEnd: "2026-07-01T00:00:00.000Z",
            creditRenewalAt: "2026-07-01T00:00:00.000Z",
            cancelAtPeriodEnd: false,
            paymentGraceExpiresAt: null,
            canceledAt: null,
            cancellationReason: null,
            createdAt: "2026-06-01T00:00:00.000Z",
            costKiloCredits: 20,
          },
        ],
        "byok.list": [
          {
            id: "personal-minimax",
            provider_id: "minimax",
            provider_name: "minimax",
            management_source: "user",
            is_enabled: true,
            created_at: "2026-06-01T00:00:00.000Z",
            updated_at: "2026-06-01T00:00:00.000Z",
            created_by: "user",
          },
        ],
      }
      return Promise.resolve(ok(values[procedure]))
    }) as unknown as typeof fetch

    const result = yield* ProviderUsage.Service.use((usage) => usage.get()).pipe(
      Effect.provide(
        layer(
          {
            type: "oauth",
            access: "kilo-private-token",
            refresh: "refresh-private-token",
            expires: Date.now() + 60_000,
          },
          {},
        ),
      ),
    )
    global.fetch = original

    expect(calls).toEqual(["user.getAutoTopUpPaymentMethod", "codingPlans.listSubscriptions", "byok.list"])
    expect(result.items).toEqual([])
  }),
)

it.instance("retries failed sources without re-querying successful siblings", () =>
  Effect.gen(function* () {
    const original = global.fetch
    const originalNow = Date.now
    const calls = { global: 0, china: 0 }
    let now = 1_000_000
    Date.now = () => now
    global.fetch = ((url: string | URL | Request) => {
      if (String(url).includes("api.minimax.io")) {
        calls.global++
        return Promise.resolve(new Response("failed", { status: 500 }))
      }
      calls.china++
      return Promise.resolve(native())
    }) as unknown as typeof fetch

    yield* Effect.gen(function* () {
      const usage = yield* ProviderUsage.Service
      yield* usage.get()
      now += 11_000
      yield* usage.get()
    }).pipe(
      Effect.provide(
        layer(undefined, {
          "minimax-coding-plan": info("minimax-coding-plan", "sk-cp-global"),
          "minimax-cn-coding-plan": info("minimax-cn-coding-plan", "sk-cp-china"),
        }),
      ),
    )
    global.fetch = original
    Date.now = originalNow

    expect(calls).toEqual({ global: 2, china: 1 })
  }),
)

it.instance("skips every personal Cloud procedure in organization context", () =>
  Effect.gen(function* () {
    const original = global.fetch
    let calls = 0
    global.fetch = (() => {
      calls++
      return Promise.resolve(Response.json({ error: {} }))
    }) as unknown as typeof fetch

    const result = yield* ProviderUsage.Service.use((usage) => usage.get()).pipe(
      Effect.provide(
        layer(
          {
            type: "oauth",
            access: "kilo-token",
            refresh: "refresh",
            expires: Date.now() + 60_000,
            accountId: "organization",
          },
          {},
        ),
      ),
    )
    global.fetch = original

    expect(calls).toBe(0)
    expect(result.items).toEqual([])
    expect(result.kiloBilling).toBeUndefined()
  }),
)
