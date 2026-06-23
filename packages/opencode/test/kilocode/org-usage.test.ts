import { describe, expect, test } from "bun:test"
import {
  fetchUsageSummary,
  formatSummaryForPeriod,
  formatSummaryTable,
  handleUsage,
  resolvePeriod,
  resolveOrg,
  summaryInput,
  summaryInputForPeriod,
} from "@/kilocode/cli/cmd/org"

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

describe("org usage", () => {
  test("builds the default summary input", () => {
    const now = new Date(2026, 5, 23, 11, 33, 56)
    const start = new Date(2026, 5, 23, 0, 0, 0)
    expect(summaryInput(now)).toEqual({
      startDate: start.toISOString(),
      endDate: now.toISOString(),
      granularity: "day",
      costSource: "cost",
      personalScope: "include-orgs",
      viewAs: "org-wide",
    })
  })

  test("builds weekly and monthly summary inputs", () => {
    const now = new Date(2026, 5, 23, 11, 33, 56)
    expect(summaryInputForPeriod("week", now)).toEqual({
      startDate: new Date(2026, 5, 22, 0, 0, 0).toISOString(),
      endDate: now.toISOString(),
      granularity: "week",
      costSource: "cost",
      personalScope: "include-orgs",
      viewAs: "org-wide",
    })
    expect(summaryInputForPeriod("month", now)).toEqual({
      startDate: new Date(2026, 5, 1, 0, 0, 0).toISOString(),
      endDate: now.toISOString(),
      granularity: "month",
      costSource: "cost",
      personalScope: "include-orgs",
      viewAs: "org-wide",
    })
  })

  test("prompts for a usage period with day as the default", async () => {
    const defaults: string[] = []

    const period = await resolvePeriod({
      selectPeriod: async (input) => {
        defaults.push(input.current)
        return "week"
      },
    })

    expect(period).toBe("week")
    expect(defaults).toEqual(["day"])
  })

  test("uses an explicit usage period without prompting", async () => {
    const period = await resolvePeriod({
      period: "month",
      selectPeriod: async () => {
        throw new Error("should not prompt")
      },
    })

    expect(period).toBe("month")
  })

  test("fetches the usage summary with the active org header", async () => {
    const calls: Request[] = []
    const fetcher = (async (input, init) => {
      const req = new Request(input, init)
      calls.push(req)
      return Response.json([{ result: { data: { json: { totalCost: 12.34 } } } }])
    }) satisfies Fetch

    const result = await fetchUsageSummary({ token: "token", org: "org_123", fetch: fetcher })

    expect(result).toEqual({ totalCost: 12.34 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain("/api/trpc/usageAnalytics.getSummary?")
    const url = new URL(calls[0].url)
    const input = JSON.parse(url.searchParams.get("input") ?? "{}")
    expect(input["0"].startDate).toBeString()
    expect(input["0"].endDate).toBeString()
    expect(input["0"].granularity).toBe("day")
    expect(input["0"].costSource).toBe("cost")
    expect(input["0"].personalScope).toBe("include-orgs")
    expect(input["0"].viewAs).toBe("org-wide")
    expect(input["0"].organizationId).toBe("org_123")
    expect(calls[0].headers.get("authorization")).toBe("Bearer token")
    expect(calls[0].headers.get("x-kilocode-organizationid")).toBe("org_123")
  })

  test("formats microdollar fields as dollars", () => {
    expect(
      formatSummaryForPeriod(
        {
          totalCostMicros: 1_234_567,
          costPerRequest: 6309.126,
          requests: 2,
          byDay: [{ date: "2026-06-23", costMicros: 500_000 }],
        },
        summaryInput(new Date(2026, 5, 23, 11, 33, 56)),
      ),
    ).toBe(
      [
        "Date: 2026-06-23",
        "",
        "Cost & Tokens",
        "Total Cost: $1.23",
        "Cost Per Request: $0.01",
        "",
        "Operations",
        "Requests: 2",
        "",
        "Details",
        "By Day:",
        "  By Day 1:",
        "    Date: 2026-06-23",
        "    Cost: $0.50",
      ].join("\n"),
    )
  })

  test("groups operational metrics separately from totals", () => {
    expect(
      formatSummaryForPeriod(
        {
          totalCostMicros: 1_234_567,
          totalTokens: 100_000,
          errorRate: 0.03,
          p95LatencyMs: 210,
          model: "kilo-auto",
        },
        {
          startDate: new Date(2026, 5, 23, 0, 0, 0).toISOString(),
          endDate: new Date(2026, 5, 23, 23, 59, 59).toISOString(),
          granularity: "day",
          costSource: "cost",
          personalScope: "include-orgs",
          viewAs: "org-wide",
        },
      ),
    ).toBe(
      [
        "Date: 2026-06-23",
        "",
        "Cost & Tokens",
        "Total Cost: $1.23",
        "Total Tokens: 100,000",
        "",
        "Operations",
        "Error Rate: 0.03",
        "P95 Latency Ms: 210",
        "",
        "Details",
        "Model: kilo-auto",
      ].join("\n"),
    )
  })

  test("formats the default summary table", () => {
    const out = formatSummaryTable(
      {
        costMicrodollars: 1_234_567,
        costPerRequest: 617_283.5,
        tokensPerRequest: 1000.5,
        totalTokens: 2_000,
        inputTokens: 1_000,
        outputTokens: 200,
        cacheHitTokens: 300,
        cacheWriteTokens: 500,
        requestCount: 2,
        distinctUsers: 1,
        errorCount: 1,
        errorRate: 0.5,
        avgLatencyMs: 1234.5,
        byokRequestCount: 1,
        freeRequestCount: 0,
        cancelledCount: 0,
      },
      summaryInput(new Date(2026, 5, 23, 11, 33, 56)),
    )

    expect(out).toContain("│                        OVERVIEW                        │")
    expect(out).toContain("│                     COST & TOKENS                      │")
    expect(out).toContain("│                       OPERATIONS                       │")
    expect(out).toContain("│Cost                                              $1.23 │")
    expect(out).toContain("│Cost/Request                                      $0.62 │")
    expect(out).toContain("│Avg Latency                                  1,234.5 ms │")
  })

  test("prints the boxed summary for the authenticated org", async () => {
    const out: string[] = []
    const codes: number[] = []
    const calls: Request[] = []
    const fetcher = (async (input, init) => {
      calls.push(new Request(input, init))
      return Response.json([{ result: { data: { json: { costMicrodollars: 1_234_567, requestCount: 2 } } } }])
    }) satisfies Fetch

    await handleUsage({
      period: "month",
      getAuth: async () => ({ type: "oauth", access: "token", refresh: "refresh", expires: Date.now(), accountId: "org_123" }),
      getProfile: async () => ({ email: "test@example.com", organizations: [{ id: "org_123", name: "Org", role: "owner" }] }),
      fetch: fetcher,
      write: (msg) => out.push(msg),
      error: (msg) => out.push(msg),
      exit: (code) => codes.push(code),
    })

    expect(codes).toEqual([])
    expect(out[0]).toContain("OVERVIEW")
    expect(out[0]).toContain("COST & TOKENS")
    expect(out[0]).toContain("OPERATIONS")
    expect(out[0]).toContain("│Cost                                              $1.23 │")
    expect(out[0]).toContain("│Requests                                              2 │")
    const url = new URL(calls[0].url)
    const input = JSON.parse(url.searchParams.get("input") ?? "{}")
    expect(input["0"].granularity).toBe("month")
  })

  test("prints the verbose summary when requested", async () => {
    const out: string[] = []
    const fetcher = (async () =>
      Response.json([{ result: { data: { json: { costMicrodollars: 1_234_567, requestCount: 2 } } } }])) satisfies Fetch

    await handleUsage({
      verbose: true,
      selectPeriod: async () => "day",
      getAuth: async () => ({ type: "oauth", access: "token", refresh: "refresh", expires: Date.now(), accountId: "org_123" }),
      getProfile: async () => ({ email: "test@example.com", organizations: [{ id: "org_123", name: "Org", role: "owner" }] }),
      fetch: fetcher,
      write: (msg) => out.push(msg),
      error: (msg) => out.push(msg),
      exit: () => undefined,
    })

    expect(out[0]).toContain("Date: ")
    expect(out[0]).toContain("Cost & Tokens\nCost: $1.23")
    expect(out[0]).toContain("Operations\nRequest Count: 2")
  })

  test("prints the raw response when json is requested", async () => {
    const out: string[] = []
    const raw = [{ result: { data: { json: { totalCostMicros: 1_234_567 } } } }]
    const fetcher = (async () => Response.json(raw)) satisfies Fetch

    await handleUsage({
      json: true,
      selectPeriod: async () => "day",
      getAuth: async () => ({ type: "oauth", access: "token", refresh: "refresh", expires: Date.now(), accountId: "org_123" }),
      getProfile: async () => ({ email: "test@example.com", organizations: [{ id: "org_123", name: "Org", role: "owner" }] }),
      fetch: fetcher,
      write: (msg) => out.push(msg),
      error: (msg) => out.push(msg),
      exit: () => undefined,
    })

    expect(out).toEqual([JSON.stringify(raw, null, 2) + "\n"])
  })

  test("prompts for an org when multiple orgs are available", async () => {
    const saved: string[] = []
    const auth = { type: "oauth", access: "token", refresh: "refresh", expires: Date.now(), accountId: "org_1" } as const

    const org = await resolveOrg({
      auth,
      getProfile: async () => ({
        email: "test@example.com",
        organizations: [
          { id: "org_1", name: "One", role: "owner" },
          { id: "org_2", name: "Two", role: "member" },
        ],
      }),
      selectOrg: async () => "org_2",
      setAuth: async (_id, info) => {
        saved.push(info.type === "oauth" ? (info.accountId ?? "") : "")
      },
    })

    expect(org).toBe("org_2")
    expect(saved).toEqual(["org_2"])
  })

  test("selects the only org without prompting when none is selected", async () => {
    const saved: string[] = []
    const auth = { type: "oauth", access: "token", refresh: "refresh", expires: Date.now() } as const

    const org = await resolveOrg({
      auth,
      getProfile: async () => ({ email: "test@example.com", organizations: [{ id: "org_1", name: "One", role: "owner" }] }),
      selectOrg: async () => {
        throw new Error("should not prompt")
      },
      setAuth: async (_id, info) => {
        saved.push(info.type === "oauth" ? (info.accountId ?? "") : "")
      },
    })

    expect(org).toBe("org_1")
    expect(saved).toEqual(["org_1"])
  })

  test("replaces a stale accountId with the only profile org", async () => {
    const saved: string[] = []
    const auth = { type: "oauth", access: "token", refresh: "refresh", expires: Date.now(), accountId: "org_old" } as const

    const org = await resolveOrg({
      auth,
      getProfile: async () => ({ email: "test@example.com", organizations: [{ id: "org_1", name: "One", role: "owner" }] }),
      selectOrg: async () => {
        throw new Error("should not prompt")
      },
      setAuth: async (_id, info) => {
        saved.push(info.type === "oauth" ? (info.accountId ?? "") : "")
      },
    })

    expect(org).toBe("org_1")
    expect(saved).toEqual(["org_1"])
  })

  test("does not use a stale accountId when the profile has no orgs", async () => {
    const auth = { type: "oauth", access: "token", refresh: "refresh", expires: Date.now(), accountId: "org_old" } as const

    const org = await resolveOrg({
      auth,
      getProfile: async () => ({ email: "test@example.com", organizations: [] }),
    })

    expect(org).toBeUndefined()
  })

  test("requires an authenticated org", async () => {
    const errors: string[] = []
    const codes: number[] = []

    await handleUsage({
      getAuth: async () => ({ type: "oauth", access: "token", refresh: "refresh", expires: Date.now() }),
      getProfile: async () => ({ email: "test@example.com", organizations: [] }),
      error: (msg) => errors.push(msg),
      exit: (code) => codes.push(code),
    })

    expect(errors).toEqual(["No Kilo organization selected for the authenticated account"])
    expect(codes).toEqual([1])
  })
})
