import { describe, expect, test } from "bun:test"
import type { ProviderUsage } from "@opencode/schema/kilocode/provider-usage"
import { Effect } from "effect"
import { UsageCache } from "../src/provider-usage/cache"
import { UsageCloud } from "../src/provider-usage/cloud"
import { CodexUsage } from "../src/provider-usage/codex"
import { contain } from "../src/provider-usage/index"
import { MiniMaxUsage } from "../src/provider-usage/minimax"

// The v1 assertions of packages/core/test/kilocode-provider-usage-{cloud,codex,minimax}.test.ts on main that cover the
// requests and the mapping. A local fetch stands in for ChatGPT and MiniMax.
function fetcher(answer: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fn = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: init?.headers as Record<string, string> })
      return answer(String(input), init)
    },
    { preconnect: fetch.preconnect },
  )
  return { fn, calls }
}

describe("Codex usage", () => {
  test("reads the ChatGPT rate limits with the account header", async () => {
    const remote = fetcher(() =>
      Response.json({
        plan_type: "pro",
        rate_limit: {
          primary_window: { used_percent: 42, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
          secondary_window: { used_percent: 100, limit_window_seconds: 604_800, reset_after_seconds: 60 },
        },
        additional_rate_limits: [
          {
            limit_name: "GPT-5 Codex Spark",
            metered_feature: "spark",
            rate_limit: { primary_window: { used_percent: 5 } },
          },
        ],
      }),
    )
    const item = await CodexUsage.load({ label: "OpenAI", access: "access-token", account: "acct_1" }, remote.fn)
    expect(remote.calls).toEqual([
      {
        url: "https://chatgpt.com/backend-api/wham/usage",
        headers: { Accept: "application/json", Authorization: "Bearer access-token", "ChatGPT-Account-Id": "acct_1" },
      },
    ])
    expect(item).toMatchObject({
      id: "codex-chatgpt",
      providerID: "openai",
      planLabel: "ChatGPT Pro",
      sourceLabel: "ChatGPT OAuth",
      fetchState: "ready",
      managementUrl: "https://chatgpt.com/codex/settings/usage",
    })
    expect(
      item.windows.map((window) => [window.id, window.resource, window.used, window.period, window.state]),
    ).toEqual([
      ["codex-primary", "Codex", 42, { unit: "hour", value: 5 }, "active"],
      ["codex-secondary", "Codex", 100, { unit: "week", value: 1 }, "exhausted"],
      ['["additional","spark",0]-primary', "GPT-5 Codex Spark", 5, undefined, "active"],
    ])
    expect(item.windows[0].resetAt).toBe(new Date(1_800_000_000_000).toISOString())
  })

  test("asks for a new sign-in on 401 and reports other failures as retryable", async () => {
    const denied = await CodexUsage.load(
      { label: "OpenAI", access: "x" },
      fetcher(() => new Response(null, { status: 401 })).fn,
    )
    expect(denied).toMatchObject({
      fetchState: "unavailable",
      error: { code: "codex_auth_unavailable", message: "Reconnect ChatGPT to view Codex usage.", retryable: false },
    })
    // v1 guard: a plan type that names an Object.prototype member falls back to the generic label.
    expect(CodexUsage.normalize({ plan: "constructor", additional: [] }).planLabel).toBe("ChatGPT Codex")
    const invalid = await CodexUsage.load({ label: "OpenAI", access: "x" }, fetcher(() => Response.json({})).fn)
    expect(invalid.error).toEqual({ code: "codex_usage_unavailable", message: "Usage unavailable.", retryable: true })
  })
})

describe("MiniMax usage", () => {
  test("maps interval and weekly quotas, boosts and the remaining count", async () => {
    const remote = fetcher(() =>
      Response.json({
        base_resp: { status_code: 0 },
        model_remains: [
          {
            model_name: "general",
            current_interval_remaining_percent: 40,
            interval_boost_permille: 1500,
            start_time: 0,
            end_time: 18_000_000,
            current_weekly_total_count: 100,
            current_weekly_usage_count: 30,
          },
          { model_name: "speech", current_interval_status: 3 },
          { model_name: "video", current_interval_remaining_percent: 10 },
        ],
      }),
    )
    const item = await MiniMaxUsage.load(
      { providerID: "minimax-cn-coding-plan", label: "MiniMax CN", key: "sk-cp-key" },
      remote.fn,
    )
    expect(remote.calls[0]).toEqual({
      url: "https://api.minimaxi.com/v1/token_plan/remains",
      headers: { Accept: "application/json", Authorization: "Bearer sk-cp-key" },
    })
    expect(item).toMatchObject({
      id: "minimax-direct-china",
      providerLabel: "MiniMax",
      planLabel: "MiniMax Token Plan",
      sourceLabel: "MiniMax CN",
      fetchState: "ready",
      managementUrl: "https://platform.minimaxi.com/subscribe/token-plan",
    })
    expect(item.windows).toMatchObject([
      {
        id: "general-interval",
        unit: "standard_units",
        orientation: "amount",
        remaining: 60,
        limit: 150,
        used: 90,
        period: { unit: "hour", value: 5 },
        state: "active",
      },
      // The usage count is the remaining quota.
      { id: "general-weekly", unit: "count", remaining: 30, used: 70, limit: 100, period: { unit: "week", value: 1 } },
      { id: "speech-interval", state: "not_in_plan" },
    ])
  })

  test("an application error is unavailable", async () => {
    const item = await MiniMaxUsage.load(
      { providerID: "minimax-coding-plan", label: "MiniMax", key: "sk-cp-key" },
      fetcher(() => Response.json({ base_resp: { status_code: 1004 }, model_remains: [] })).fn,
    )
    expect(item).toMatchObject({ id: "minimax-direct-global", fetchState: "unavailable", windows: [] })
  })
})

describe("Kilo coding plans", () => {
  const subscription = {
    id: "sub-1",
    planId: "plan",
    planName: "Pro",
    providerName: "Anthropic",
    providerId: "anthropic",
    canQueryUsage: true,
    hasInstalledByokKey: true,
    status: "active" as const,
    cancelAtPeriodEnd: false,
  }

  test("keep active plans whose coding plan key is installed and enabled", () => {
    const key = { id: "k", provider_id: "anthropic", management_source: "coding_plan" as const, is_enabled: true }
    expect(UsageCloud.plans([subscription], [key])).toEqual([subscription])
    expect(UsageCloud.plans([subscription], [{ ...key, management_source: "user" }])).toEqual([])
    expect(UsageCloud.plans([subscription], [{ ...key, is_enabled: false }])).toEqual([])
    expect(UsageCloud.plans([{ ...subscription, status: "canceled" }], [key])).toEqual([])
  })

  test("link plan management to the web app", () => {
    expect(UsageCloud.app("https://api.kilo.ai")).toBe("https://app.kilo.ai")
    expect(UsageCloud.app("http://127.0.0.1:3000/api")).toBe("http://127.0.0.1:3000")
    const item = UsageCloud.snapshot({ ...subscription, cancelAtPeriodEnd: true }, undefined, "https://app.kilo.ai")
    expect(item).toMatchObject({
      id: "kilo-managed:sub-1",
      planState: "canceling",
      fetchState: "unavailable",
      managementUrl: "https://app.kilo.ai/subscriptions/coding-plans/sub-1",
    })
  })
})

describe("direct source cache", () => {
  const snapshot = (
    fetchState: ProviderUsage.UsageSnapshot["fetchState"],
    used: number,
  ): ProviderUsage.UsageSnapshot => ({
    id: "codex-chatgpt",
    providerID: "openai",
    sourceKind: "direct",
    providerLabel: "OpenAI",
    planLabel: "ChatGPT Pro",
    sourceLabel: "ChatGPT OAuth",
    fetchState,
    planState: fetchState === "ready" ? "active" : "unknown",
    routingState: "not_applicable",
    windows:
      fetchState === "ready"
        ? [{ id: "w", resource: "Codex", unit: "percent", orientation: "used_percent", used, state: "active" }]
        : [],
    ...(fetchState === "ready"
      ? {}
      : { error: { code: "codex_usage_unavailable", message: "Usage unavailable.", retryable: true } }),
  })

  test("keeps good answers for 60 s, failures for 10 s, and the last good windows as stale", async () => {
    let now = 1_000_000
    const cache = UsageCache.make(() => now)
    const answers = [snapshot("ready", 10), snapshot("unavailable", 0), snapshot("ready", 20)]
    let calls = 0
    const load = async () => answers[calls++]
    expect((await cache.source("codex-chatgpt", "token", false, load)).windows[0].used).toBe(10)
    now += 59_000
    await cache.source("codex-chatgpt", "token", false, load)
    expect(calls).toBe(1)
    // refresh bypasses the cache; the failure keeps the last windows as stale.
    const failed = await cache.source("codex-chatgpt", "token", true, load)
    expect(failed).toMatchObject({
      fetchState: "stale",
      windows: [{ used: 10 }],
      error: { message: "Usage unavailable." },
    })
    now += 9_000
    await cache.source("codex-chatgpt", "token", false, load)
    expect(calls).toBe(2)
    now += 2_000
    expect((await cache.source("codex-chatgpt", "token", false, load)).windows[0].used).toBe(20)
    expect(calls).toBe(3)
  })

  test("overlapping calls share one load", async () => {
    const cache = UsageCache.make(() => 0)
    let calls = 0
    const load = async () => {
      calls++
      await Bun.sleep(5)
      return snapshot("ready", calls)
    }
    const [first, second] = await Promise.all([
      cache.source("codex-chatgpt", "token", false, load),
      cache.source("codex-chatgpt", "token", true, load),
    ])
    expect(calls).toBe(1)
    expect(second).toBe(first)
  })

  test("a new credential never shows the previous quota", async () => {
    const cache = UsageCache.make(() => 0)
    await cache.source("codex-chatgpt", "first", false, async () => snapshot("ready", 10))
    const other = await cache.source("codex-chatgpt", "second", false, async () => snapshot("unavailable", 0))
    expect(other).toMatchObject({ fetchState: "unavailable", windows: [] })
  })

  test("a failed credential read keeps the last snapshot as stale, and gone sources are dropped", async () => {
    let now = 5_000
    const cache = UsageCache.make(() => now)
    expect(cache.preserve("codex-chatgpt")).toEqual([])
    await cache.source("codex-chatgpt", "token", false, async () => snapshot("ready", 10))
    now = 8_000
    const kept = cache.preserve("codex-chatgpt")
    expect(kept).toMatchObject([
      { fetchState: "stale", windows: [{ used: 10 }], error: { code: "source_refresh_unavailable" } },
    ])
    // generatedAt is the time of the newest data, not of the request.
    now = 20_000
    expect(cache.settle(kept)).toBe(new Date(8_000).toISOString())
    expect(cache.settle([])).toBe(new Date(20_000).toISOString())
    expect(cache.preserve("codex-chatgpt")).toEqual([])
  })
})

describe("managed cloud cache", () => {
  const subscription = {
    id: "sub-1",
    planId: "plan",
    planName: "Pro",
    providerName: "Anthropic",
    providerId: "anthropic",
    canQueryUsage: true,
    hasInstalledByokKey: true,
    status: "active" as const,
    cancelAtPeriodEnd: false,
  }
  const key = { id: "k", provider_id: "anthropic", management_source: "coding_plan" as const, is_enabled: true }
  const goodState: UsageCache.CloudState = {
    plans: { ok: true, value: [subscription] },
    byok: { ok: true, value: [key] },
  }
  const failedState: UsageCache.CloudState = {
    plans: { ok: false },
    byok: { ok: true, value: [key] },
  }
  const good: UsageCache.Cloud = {
    identity: "one",
    ...goodState,
  }
  const failed: UsageCache.Cloud = {
    identity: "one",
    ...failedState,
  }
  const snapshot = (id: string, used: number): ProviderUsage.UsageSnapshot => ({
    id,
    providerID: "anthropic",
    sourceKind: "kilo_managed",
    providerLabel: "Anthropic",
    planLabel: "Pro",
    sourceLabel: "via Kilo",
    fetchState: "ready",
    planState: "active",
    routingState: "active",
    windows: [
      { id: `${id}:w`, resource: "subscription", unit: "percent", orientation: "remaining_percent", used, state: "active" },
    ],
  })

  test("keeps a good answer for 60 s and the previous answer when a refresh fails", async () => {
    let now = 1_000_000
    const cache = UsageCache.make(() => now)
    let calls = 0
    const load = async () => (calls++ === 0 ? goodState : failedState)
    expect(await cache.cloud("one", false, load)).toEqual(good)
    now += 10_000
    expect(await cache.cloud("one", false, load)).toEqual(good)
    expect(calls).toBe(1)
    // Past the success TTL the loader runs again; its failed part keeps the previous plans.
    now += 51_000
    expect(await cache.cloud("one", false, load)).toEqual(good)
    expect(calls).toBe(2)
    // The kept answer uses the error TTL.
    now += 9_000
    await cache.cloud("one", false, load)
    expect(calls).toBe(2)
    now += 2_000
    await cache.cloud("one", false, load)
    expect(calls).toBe(3)
  })

  test("keeps a failed answer for 10 s when there is no previous value", async () => {
    let now = 0
    const cache = UsageCache.make(() => now)
    let calls = 0
    const load = async () => {
      calls++
      return failedState
    }
    expect(await cache.cloud("one", false, load)).toEqual(failed)
    now += 9_000
    await cache.cloud("one", false, load)
    expect(calls).toBe(1)
    now += 2_000
    await cache.cloud("one", false, load)
    expect(calls).toBe(2)
  })

  test("preserves the managed quotas as stale and prunes or clears them", async () => {
    const cache = UsageCache.make(() => 0)
    await cache.source("kilo-managed:a", "one", false, async () => snapshot("kilo-managed:a", 10))
    await cache.source("kilo-managed:b", "one", false, async () => snapshot("kilo-managed:b", 20))
    await cache.source("codex-chatgpt", "token", false, async () => snapshot("codex-chatgpt", 5))

    expect(cache.preservePrefix("kilo-managed:", "one")).toMatchObject([
      { id: "kilo-managed:a", fetchState: "stale", windows: [{ used: 10 }] },
      { id: "kilo-managed:b", fetchState: "stale", windows: [{ used: 20 }] },
    ])
    cache.prunePrefix("kilo-managed:", ["kilo-managed:a"])
    expect(cache.preservePrefix("kilo-managed:", "one")).toMatchObject([{ id: "kilo-managed:a" }])

    await cache.cloud("one", false, async () => goodState)
    cache.clearManaged()
    expect(cache.preservePrefix("kilo-managed:", "one")).toEqual([])
    // The cloud answer is cleared too, and the direct sources stay.
    let reloaded = 0
    await cache.cloud("one", false, async () => {
      reloaded++
      return goodState
    })
    expect(reloaded).toBe(1)
    expect(cache.preserve("codex-chatgpt")).toMatchObject([{ id: "codex-chatgpt", fetchState: "stale" }])
  })

  test("preservePrefix returns only the cells of the requested account", async () => {
    const cache = UsageCache.make(() => 0)
    await cache.source("kilo-managed:a", "a", false, async () => snapshot("kilo-managed:a", 10))

    expect(cache.preservePrefix("kilo-managed:", "b")).toEqual([])
    expect(cache.preservePrefix("kilo-managed:", undefined)).toEqual([])
    expect(cache.preservePrefix("kilo-managed:", "a")).toMatchObject([
      { id: "kilo-managed:a", fetchState: "stale", windows: [{ used: 10 }] },
    ])
  })

  test("a new account identity drops the cached managed quotas", async () => {
    const cache = UsageCache.make(() => 0)
    await cache.cloud("one", false, async () => goodState)
    await cache.source("kilo-managed:a", "one", false, async () => snapshot("kilo-managed:a", 10))
    const otherState: UsageCache.CloudState = { plans: { ok: true, value: [] }, byok: { ok: true, value: [] } }
    const other: UsageCache.Cloud = { identity: "two", ...otherState }
    expect(await cache.cloud("two", true, async () => otherState)).toEqual(other)
    expect(cache.preservePrefix("kilo-managed:", "one")).toEqual([])
  })

  test("a new identity never keeps the previous account plans when the read fails", async () => {
    let now = 0
    const cache = UsageCache.make(() => now)
    await cache.cloud("one", false, async () => goodState)
    await cache.source("kilo-managed:a", "one", false, async () => snapshot("kilo-managed:a", 10))

    const failedOtherState: UsageCache.CloudState = { plans: { ok: false }, byok: { ok: false } }
    const failedOther: UsageCache.Cloud = { identity: "two", ...failedOtherState }
    expect(await cache.cloud("two", true, async () => failedOtherState)).toEqual(failedOther)
    expect(cache.preservePrefix("kilo-managed:", "one")).toEqual([])

    // The failed answer expires with the error TTL, then the new account's good answer is used.
    now += 10_000
    const otherState: UsageCache.CloudState = { plans: { ok: true, value: [subscription] }, byok: { ok: true, value: [key] } }
    const other: UsageCache.Cloud = { identity: "two", ...otherState }
    expect(await cache.cloud("two", false, async () => otherState)).toEqual(other)
  })

  test("a cache hit of one identity is not returned for another and prunes the previous sources", async () => {
    const cache = UsageCache.make(() => 0)
    expect(await cache.cloud("a", false, async () => goodState)).toEqual({ identity: "a", ...goodState })
    await cache.source("kilo-managed:a", "a", false, async () => snapshot("kilo-managed:a", 10))

    const otherState: UsageCache.CloudState = { plans: { ok: true, value: [] }, byok: { ok: true, value: [] } }
    const other: UsageCache.Cloud = { identity: "b", ...otherState }
    let loads = 0
    expect(
      await cache.cloud("b", false, async () => {
        loads++
        return otherState
      }),
    ).toEqual(other)
    expect(loads).toBe(1)
    expect(cache.preservePrefix("kilo-managed:", "a")).toEqual([])

    // A second call of the new identity uses its own cached answer.
    expect(
      await cache.cloud("b", false, async () => {
        loads++
        return otherState
      }),
    ).toEqual(other)
    expect(loads).toBe(1)
  })

  test("concurrent calls of different identities do not share the in-flight load", async () => {
    const cache = UsageCache.make(() => 0)
    let loads = 0
    const load = (state: UsageCache.CloudState) => async () => {
      loads++
      await Bun.sleep(5)
      return state
    }
    const stateA: UsageCache.CloudState = { plans: { ok: true, value: [subscription] }, byok: { ok: true, value: [] } }
    const stateB: UsageCache.CloudState = { plans: { ok: true, value: [] }, byok: { ok: true, value: [] } }
    const [first, second] = await Promise.all([
      cache.cloud("a", false, load(stateA)),
      cache.cloud("b", false, load(stateB)),
    ])
    expect(loads).toBe(2)
    expect(first).toEqual({ identity: "a", ...stateA })
    expect(second).toEqual({ identity: "b", ...stateB })
  })

  test("a rejected load does not poison the cache", async () => {
    const cache = UsageCache.make(() => 0)
    await expect(
      cache.cloud("one", false, async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(await cache.cloud("one", false, async () => goodState)).toEqual(good)
  })

  test("a pruned source cannot be re-added by an in-flight load", async () => {
    const cache = UsageCache.make(() => 0)
    await cache.cloud("one", false, async () => goodState)
    let release!: () => void
    const running = cache.source(
      "kilo-managed:a",
      "one",
      false,
      () =>
        new Promise((resolve) => {
          release = () => resolve(snapshot("kilo-managed:a", 10))
        }),
    )
    const otherState: UsageCache.CloudState = { plans: { ok: true, value: [] }, byok: { ok: true, value: [] } }
    await cache.cloud("two", true, async () => otherState)
    release()
    expect((await running).windows[0].used).toBe(10)
    expect(cache.preservePrefix("kilo-managed:", "one")).toEqual([])
  })
})

describe("managed defect containment", () => {
  const fallback: ProviderUsage.UsageSnapshot[] = [
    {
      id: "kilo-managed:kept",
      providerID: "anthropic",
      sourceKind: "kilo_managed",
      providerLabel: "Anthropic",
      planLabel: "Pro",
      sourceLabel: "via Kilo",
      fetchState: "stale",
      planState: "active",
      routingState: "active",
      windows: [],
    },
  ]

  // The guard of the managed group in packages/kilo-plugin/src/provider-usage/index.ts.
  const guarded = (effect: Effect.Effect<ProviderUsage.UsageSnapshot[], unknown>) =>
    contain(effect, () => fallback)

  test("a failure or a defect answers with the fallback instead of failing the read", async () => {
    expect(await Effect.runPromise(guarded(Effect.succeed<ProviderUsage.UsageSnapshot[]>([])))).toEqual([])
    expect(await Effect.runPromise(guarded(Effect.fail("failed")))).toEqual(fallback)
    expect(await Effect.runPromise(guarded(Effect.die("boom")))).toEqual(fallback)
    // The production fallback of the managed group returns no unverified cells.
    expect(await Effect.runPromise(contain(Effect.die("boom"), () => []))).toEqual([])
  })
})
