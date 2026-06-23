import { describe, expect, test } from "bun:test"
import { fetchUsageSummary, handleUsage, summaryInput } from "@/kilocode/cli/cmd/org"

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

describe("org usage", () => {
  test("builds the default summary input", () => {
    expect(summaryInput(new Date("2026-06-23T17:33:56.000Z"))).toEqual({
      startDate: "2026-05-24T17:33:56.000Z",
      endDate: "2026-06-23T17:33:56.000Z",
      granularity: "day",
    })
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
    expect(calls[0].headers.get("authorization")).toBe("Bearer token")
    expect(calls[0].headers.get("x-kilocode-organizationid")).toBe("org_123")
  })

  test("prints the summary for the authenticated org", async () => {
    const out: string[] = []
    const codes: number[] = []
    const fetcher = (async () => Response.json([{ result: { data: { json: { requests: 2 } } } }])) satisfies Fetch

    await handleUsage({
      getAuth: async () => ({ type: "oauth", access: "token", refresh: "refresh", expires: Date.now(), accountId: "org_123" }),
      fetch: fetcher,
      write: (msg) => out.push(msg),
      error: (msg) => out.push(msg),
      exit: (code) => codes.push(code),
    })

    expect(codes).toEqual([])
    expect(out).toEqual([JSON.stringify({ requests: 2 }, null, 2) + "\n"])
  })

  test("requires an authenticated org", async () => {
    const errors: string[] = []
    const codes: number[] = []

    await handleUsage({
      getAuth: async () => ({ type: "oauth", access: "token", refresh: "refresh", expires: Date.now() }),
      error: (msg) => errors.push(msg),
      exit: (code) => codes.push(code),
    })

    expect(errors).toEqual(["No active Kilo organization selected"])
    expect(codes).toEqual([1])
  })
})
