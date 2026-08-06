import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { Auth } from "@/auth"
import { ProviderUsage } from "@/kilocode/provider-usage"
import * as Cloud from "@/kilocode/provider-usage/cloud"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProviderTest } from "../../fake/provider"
import { testEffect } from "../../lib/effect"

const info = (id: "minimax-coding-plan" | "minimax-cn-coding-plan", key: string) => {
  const providerID = ProviderV2.ID.make(id)
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

const subscription = {
  id: "plan",
  planId: "minimax-token-plan-plus",
  planName: "Token Plan Plus",
  providerName: "MiniMax",
  providerId: "minimax",
  hasInstalledByokKey: true,
  status: "active" as const,
  cancelAtPeriodEnd: false,
}

const managed = {
  id: "managed-minimax",
  provider_id: "minimax",
  management_source: "coding_plan" as const,
  is_enabled: true,
}

const oauth = (access: string, accountId?: string): Auth.Info => ({
  type: "oauth",
  access,
  refresh: `refresh-${access}`,
  expires: Date.now() + 60_000,
  ...(accountId ? { accountId } : {}),
})

const cloudUsage = (remaining = 80, windows?: unknown[]) => ({
  schemaVersion: 1,
  fetchedAt: "2026-06-19T00:00:00.000Z",
  subscription: {
    id: subscription.id,
    planName: subscription.planName,
    providerId: subscription.providerId,
    providerName: subscription.providerName,
    windows: windows ?? [
      {
        id: "short_term",
        remainingPercent: remaining,
        resetsAt: "2026-06-19T05:00:00.000Z",
        period: { unit: "hour", value: 5 },
      },
    ],
  },
})

it.effect("only includes managed plans with an installed managed key", () =>
  Effect.sync(() => {
    const state = (entry?: { management_source: "coding_plan" | "user"; is_enabled: boolean }) => ({
      topup: { ok: false as const },
      plans: { ok: true as const, value: [subscription] },
      byok: {
        ok: true as const,
        value: entry ? [{ ...managed, management_source: entry.management_source, is_enabled: entry.is_enabled }] : [],
      },
    })

    expect(Cloud.plans(state())).toEqual([])
    expect(Cloud.plans(state({ management_source: "user", is_enabled: true }))).toEqual([])
    expect(Cloud.plans(state({ management_source: "coding_plan", is_enabled: false }))).toEqual([])
    expect(Cloud.plans(state({ management_source: "coding_plan", is_enabled: true }))).toEqual([subscription])
    expect(Cloud.plans({ ...state(), byok: { ok: false } })).toEqual([])

    const alibaba = {
      ...subscription,
      id: "alibaba-plan",
      planId: "alibaba-coding-plan",
      planName: "Alibaba Coding Plan",
      providerName: "Alibaba",
      providerId: "alibaba",
    }
    const generic = state({ management_source: "coding_plan", is_enabled: true })
    expect(
      Cloud.plans({
        ...generic,
        plans: { ok: true, value: [alibaba] },
        byok: {
          ok: true,
          value: generic.byok.value.map((item) => ({ ...item, provider_id: "alibaba" })),
        },
      }),
    ).toEqual([alibaba])
  }),
)

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
          paymentMethod: {
            type: "card",
            brand: "visa",
            last4: "4242",
            stripePaymentMethodId: "pm_private",
          },
        },
        "codingPlans.listSubscriptions": [subscription],
        "byok.list": [managed],
        "codingPlans.getUsage": cloudUsage(80, [
          {
            id: "short_term",
            remainingPercent: 80,
            resetsAt: "2026-06-19T05:00:00.000Z",
            period: { unit: "hour", value: 5 },
          },
          {
            id: "weekly",
            remainingPercent: 150,
            resetsAt: "2026-06-26T00:00:00.000Z",
            period: { unit: "week", value: 1 },
          },
          {
            id: "billing_cycle",
            remainingPercent: 60,
            resetsAt: "2026-07-19T00:00:00.000Z",
            period: { unit: "month", value: 1 },
          },
        ]),
      }
      return Promise.resolve(ok(values[procedure]))
    }) as unknown as typeof fetch

    const result = yield* ProviderUsage.Service.use((usage) => usage.get()).pipe(
      Effect.provide(layer(oauth("kilo-private-token"), {})),
    )
    global.fetch = original

    expect(calls).toEqual([
      "user.getAutoTopUpPaymentMethod",
      "codingPlans.listSubscriptions",
      "byok.list",
      "codingPlans.getUsage",
    ])
    expect(result.items.map((item) => item.id)).toEqual(["kilo-managed:plan"])
    expect(result.items[0]).toMatchObject({
      providerID: "minimax",
      providerLabel: "MiniMax",
      planLabel: "Token Plan Plus",
      routingState: "active",
      fetchState: "ready",
      windows: [
        {
          id: "plan:short_term",
          label: "5-hour quota",
          remaining: 80,
          limit: 100,
          durationMs: 18_000_000,
          resetAt: "2026-06-19T05:00:00.000Z",
        },
        {
          id: "plan:weekly",
          label: "Weekly quota",
          remaining: 150,
          limit: 100,
          durationMs: 604_800_000,
          resetAt: "2026-06-26T00:00:00.000Z",
        },
        {
          id: "plan:billing_cycle",
          label: "Monthly quota",
          remaining: 60,
          limit: 100,
          resetAt: "2026-07-19T00:00:00.000Z",
        },
      ],
    })
    expect(result.items[0]?.windows[2]).not.toHaveProperty("durationMs")
    expect(result.kiloBilling?.autoTopUp).toMatchObject({ paymentBrand: "visa", paymentLast4: "4242" })
    expect(JSON.stringify(result)).not.toContain("pm_private")
    expect(JSON.stringify(result)).not.toContain("kilo-private-token")
  }),
)

it.instance("does not reuse personal Cloud data after the bearer identity changes", () =>
  Effect.gen(function* () {
    const original = global.fetch
    let currentAuth: Auth.Info | undefined = oauth("token-one")
    const calls: string[] = []
    const ok = (value: unknown) => Response.json({ result: { data: { json: value } } })
    global.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const procedure = new URL(String(input)).pathname.split("/").at(-1) ?? ""
      const token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "")
      const second = token === "token-two"
      calls.push(`${token}:${procedure}`)
      if (procedure === "user.getAutoTopUpPaymentMethod") {
        return Promise.resolve(
          ok({
            enabled: second,
            amountCents: second ? 10_000 : 5_000,
            thresholdCents: 500,
            paymentMethod: {
              type: "card",
              brand: "visa",
              last4: second ? "2222" : "1111",
            },
          }),
        )
      }
      if (procedure === "codingPlans.listSubscriptions") return Promise.resolve(ok([subscription]))
      if (procedure === "byok.list") return Promise.resolve(ok([managed]))
      return Promise.resolve(ok(cloudUsage(second ? 20 : 80)))
    }) as unknown as typeof fetch

    const access = Layer.mock(Auth.Service)({ get: () => Effect.sync(() => currentAuth) })
    const catalog = Layer.mock(Provider.Service)({ list: () => Effect.succeed({}) })
    const usageLayer = Layer.fresh(ProviderUsage.defaultLayer).pipe(Layer.provide(access), Layer.provide(catalog))
    const output = yield* Effect.gen(function* () {
      const usage = yield* ProviderUsage.Service
      const first = yield* usage.get()
      currentAuth = oauth("token-two")
      const second = yield* usage.get()
      return { first, second }
    }).pipe(Effect.provide(usageLayer))
    global.fetch = original

    expect(output.first.kiloBilling?.autoTopUp).toMatchObject({ amountCents: 5_000, paymentLast4: "1111" })
    expect(output.second.kiloBilling?.autoTopUp).toMatchObject({ amountCents: 10_000, paymentLast4: "2222" })
    expect(output.first.items[0]?.windows[0]?.remaining).toBe(80)
    expect(output.second.items[0]?.windows[0]?.remaining).toBe(20)
    expect(calls).toEqual([
      "token-one:user.getAutoTopUpPaymentMethod",
      "token-one:codingPlans.listSubscriptions",
      "token-one:byok.list",
      "token-one:codingPlans.getUsage",
      "token-two:user.getAutoTopUpPaymentMethod",
      "token-two:codingPlans.listSubscriptions",
      "token-two:byok.list",
      "token-two:codingPlans.getUsage",
    ])
  }),
)

it.instance("preserves managed usage as stale when the BYOK lookup fails", () =>
  Effect.gen(function* () {
    const original = global.fetch
    let byokCalls = 0
    let usageCalls = 0
    const ok = (value: unknown) => Response.json({ result: { data: { json: value } } })
    global.fetch = ((input: string | URL | Request) => {
      const procedure = new URL(String(input)).pathname.split("/").at(-1) ?? ""
      if (procedure === "user.getAutoTopUpPaymentMethod") {
        return Promise.resolve(ok({ enabled: false, amountCents: 5_000, thresholdCents: 500, paymentMethod: null }))
      }
      if (procedure === "codingPlans.listSubscriptions") return Promise.resolve(ok([subscription]))
      if (procedure === "byok.list") {
        byokCalls++
        if (byokCalls > 1) return Promise.resolve(Response.json({ error: {} }))
        return Promise.resolve(ok([managed]))
      }
      usageCalls++
      return Promise.resolve(ok(cloudUsage()))
    }) as unknown as typeof fetch

    const output = yield* Effect.gen(function* () {
      const usage = yield* ProviderUsage.Service
      const first = yield* usage.get()
      const second = yield* usage.refresh()
      return { first, second }
    }).pipe(Effect.provide(layer(oauth("kilo-private-token"), {})))
    global.fetch = original

    expect(usageCalls).toBe(1)
    expect(output.first.items[0]).toMatchObject({ fetchState: "ready", id: "kilo-managed:plan" })
    expect(output.second.items[0]).toMatchObject({
      fetchState: "stale",
      id: "kilo-managed:plan",
      error: { code: "source_refresh_unavailable" },
    })
    expect(output.second.items[0]?.windows).toEqual(output.first.items[0]?.windows)
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
      Effect.provide(layer(oauth("kilo-token", "organization"), {})),
    )
    global.fetch = original

    expect(calls).toBe(0)
    expect(result.items).toEqual([])
    expect(result.kiloBilling).toBeUndefined()
  }),
)
