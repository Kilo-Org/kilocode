import { describe, expect, mock, test } from "bun:test"
import { decode } from "@/kilocode/provider/codex/native"
import { codex, normalize, query } from "@/kilocode/provider/codex/usage"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProviderTest } from "../../../fake/provider"

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const fixture = {
  plan_type: "prolite",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 41,
      limit_window_seconds: 300 * 60,
      reset_at: 1_781_631_830,
    },
    secondary_window: {
      used_percent: 56,
      limit_window_seconds: 10_080 * 60,
      reset_at: 1_781_747_648,
    },
  },
  additional_rate_limits: [
    {
      limit_name: "GPT-5.3-Codex-Spark",
      metered_feature: "codex_bengalfox",
      rate_limit: {
        primary_window: { used_percent: 20, limit_window_seconds: 300 * 60, reset_at: 1_781_631_830 },
      },
    },
  ],
  credits: { has_credits: true, unlimited: false, balance: "9.99" },
  unknown_private_field: "strip",
}

function provider(fetcher: typeof fetch) {
  const providerID = ProviderV2.ID.make("openai")
  return ProviderTest.info(
    { id: providerID, name: "OpenAI", source: "custom", options: { fetch: fetcher } },
    ProviderTest.model({ providerID }),
  )
}

const oauth = {
  type: "oauth" as const,
  access: "private-access-token",
  refresh: "private-refresh-token",
  expires: Date.now() + 60_000,
  accountId: "private-account-id",
}

describe("Codex native normalization", () => {
  test("normalizes five-hour, weekly, and additional named buckets", () => {
    const item = normalize(decode(fixture))

    expect(item.planLabel).toBe("ChatGPT Pro Lite")
    expect(item.windows.map((window) => window.label)).toEqual([
      "Codex 5-hour",
      "Codex weekly",
      "GPT-5.3-Codex-Spark 5-hour",
    ])
    expect(item.windows[0]).toMatchObject({ orientation: "used_percent", used: 41, remaining: 59, limit: 100 })
    expect(item.credits).toEqual([
      { id: "purchased-credits", label: "Purchased credits", balance: "9.99", unit: "credits" },
    ])
  })

  test("classifies windows by duration even when primary and secondary are reversed", () => {
    const item = normalize(
      decode({
        rate_limit: {
          primary_window: { used_percent: 10, limit_window_seconds: 10_080 * 60, reset_at: 1_781_747_648 },
          secondary_window: { used_percent: 20, limit_window_seconds: 300 * 60, reset_at: 1_781_631_830 },
        },
      }),
    )

    expect(item.windows.map((window) => window.label)).toEqual(["Codex weekly", "Codex 5-hour"])
  })

  test("keeps a valid primary window when its secondary sibling is malformed", () => {
    const item = normalize(
      decode({
        rate_limit: {
          allowed: false,
          primary_window: { used_percent: 12, limit_window_seconds: 300 * 60 },
          secondary_window: { used_percent: "bad" },
        },
      }),
    )

    expect(item.windows).toHaveLength(1)
    expect(item.windows[0]).toMatchObject({ used: 12, state: "exhausted" })
    expect(normalize(decode({ rate_limit: { limit_reached: true } })).availabilityState).toBe("exhausted")
  })

  test("preserves unknown plans and ignores malformed sibling buckets", () => {
    const item = normalize(
      decode({
        plan_type: "future_workspace",
        rate_limit: { primary_window: { used_percent: 5, reset_at: 1_781_631_830 } },
        additional_rate_limits: [
          { limit_name: "broken", rate_limit: { primary_window: { used_percent: "bad" } } },
          { limit_name: "valid", rate_limit: { secondary_window: { used_percent: 30 } } },
        ],
      }),
    )

    expect(item.planLabel).toBe("ChatGPT future_workspace")
    expect(item.windows.map((window) => window.resource)).toEqual(["Codex", "valid"])
  })

  test("omits an empty spend-control object reported by Team accounts", () => {
    const item = normalize(
      decode({
        plan_type: "team",
        rate_limit: null,
        additional_rate_limits: null,
        credits: null,
        spend_control: { reached: false, individual_limit: null },
      }),
    )

    expect(item.planLabel).toBe("ChatGPT Team")
    expect(item.windows).toEqual([])
    expect(item.credits).toEqual([])
    expect(item.availabilityState).toBe("unknown")
  })

  test("uses reset_after_seconds as fallback and preserves overage exhaustion", () => {
    const before = Date.now()
    const item = normalize(
      decode({
        rate_limit: { primary_window: { used_percent: 10, reset_after_seconds: 60 } },
        credits: { has_credits: true, balance: "5", overage_limit_reached: true },
      }),
    )
    const resetAt = Date.parse(item.windows.find((window) => window.id === "codex-primary")?.resetAt ?? "")

    expect(resetAt).toBeGreaterThanOrEqual(before + 59_000)
    expect(item.windows.find((window) => window.id === "spend-control")?.state).toBe("exhausted")
    expect(item.credits[0]?.label).toContain("limit reached")
  })

  test.each([
    [undefined, []],
    [{ has_credits: true, balance: "0", unlimited: false }, [{ balance: "0", unit: "credits" }]],
    [{ has_credits: true, balance: 12.5, unlimited: false }, [{ balance: "12.5", unit: "credits" }]],
    [{ has_credits: true, balance: null, unlimited: false }, [{}]],
    [{ has_credits: true, unlimited: true }, [{ unlimited: true }]],
  ])("keeps purchased credit state distinct: %o", (credits, expected) => {
    const item = normalize(decode({ credits }))
    expect(item.credits).toHaveLength(expected.length)
    if (expected[0]) expect(item.credits[0]).toMatchObject(expected[0])
    expect(item.windows).toEqual([])
  })
})

describe("Codex OAuth usage transport", () => {
  test("uses the resolved authenticated transport with a fixed request", async () => {
    const fn = mock((_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("authorization")).toBe(false)
      return Promise.resolve(response(fixture))
    })

    const native = await query(fn as unknown as typeof fetch)

    expect(native.plan_type).toBe("prolite")
    const call = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe("https://chatgpt.com/backend-api/wham/usage")
    expect(call[1].method).toBe("GET")
    expect(call[1].redirect).toBe("error")
    expect(call[1].signal).toBeInstanceOf(AbortSignal)
    expect(new Headers(call[1].headers).get("accept")).toBe("application/json")
    expect(new Headers(call[1].headers).get("user-agent")).toMatch(/^kilocode\//)
  })

  test("detects only OAuth-backed effective OpenAI providers", async () => {
    const fn = mock(() => Promise.resolve(response(fixture))) as unknown as typeof fetch
    const providers = { openai: provider(fn) }

    expect(await codex({ type: "api", key: "sk-api" }, providers)).toEqual([])
    expect(fn).not.toHaveBeenCalled()
    const items = await codex(oauth, providers)
    expect(items).toHaveLength(1)
    expect(items[0]?.fetchState).toBe("ready")
    expect(JSON.stringify(items)).not.toContain("private-access-token")
    expect(JSON.stringify(items)).not.toContain("private-account-id")
  })

  test.each([401, 403, 429, 500])("isolates HTTP %s failures", async (status) => {
    const fn = mock(() => Promise.resolve(response({ private: "raw body" }, status))) as unknown as typeof fetch
    const items = await codex(oauth, { openai: provider(fn) })

    expect(items).toHaveLength(1)
    expect(items[0]?.fetchState).toBe("unavailable")
    expect(JSON.stringify(items)).not.toContain("raw body")
    expect(items[0]?.error?.code).toBe(
      status === 401 || status === 403 ? "codex_auth_unavailable" : "codex_usage_unavailable",
    )
  })
})
