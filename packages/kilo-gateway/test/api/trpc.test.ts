import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  CloudTrpcError,
  fetchByokEntries,
  fetchCodingPlanSubscriptions,
  fetchCodingPlanUsage,
} from "../../src/api/trpc"

const original = global.fetch

const result = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ result: { data: { json: data } } }), {
    status,
    headers: { "content-type": "application/json" },
  })

const subscription = {
  id: "subscription",
  planId: "minimax-token-plan-plus",
  planName: "Token Plan Plus",
  providerName: "MiniMax",
  providerId: "minimax",
  canQueryUsage: true,
  hasInstalledByokKey: true,
  status: "active",
  cancelAtPeriodEnd: false,
}

const quota = (id = "plan") => ({
  schemaVersion: 1,
  fetchedAt: "2026-06-19T00:00:00.000Z",
  subscription: {
    id,
    planName: "Token Plan Plus",
    providerId: "minimax",
    providerName: "MiniMax",
    windows: [
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
    ],
  },
})

afterEach(() => {
  global.fetch = original
})

describe("Cloud tRPC client", () => {
  test("uses unbatched GET queries without an organization header", async () => {
    const fn = mock(() =>
      Promise.resolve(
        result([
          {
            ...subscription,
            routeLabel: "MiniMax via Kilo Gateway",
            billingPeriodDays: 30,
            currentPeriodStart: "2026-06-01T00:00:00.000Z",
            currentPeriodEnd: "2026-07-01T00:00:00.000Z",
            creditRenewalAt: "2026-07-01T00:00:00.000Z",
            paymentGraceExpiresAt: null,
            canceledAt: null,
            cancellationReason: null,
            createdAt: "2026-06-01T00:00:00.000Z",
            costKiloCredits: 20,
            additive: "ignored",
          },
        ]),
      ),
    )
    global.fetch = fn as unknown as typeof fetch

    const subscriptions = await fetchCodingPlanSubscriptions("secret-token")

    expect(subscriptions).toHaveLength(1)
    expect(subscriptions[0]).not.toHaveProperty("additive")
    const call = fn.mock.calls[0] as unknown as [string, RequestInit]
    const url = new URL(call[0])
    expect(url.pathname).toBe("/api/trpc/codingPlans.listSubscriptions")
    expect(url.searchParams.has("batch")).toBe(false)
    expect(call[1].method).toBe("GET")
    expect(new Headers(call[1].headers).get("authorization")).toBe("Bearer secret-token")
    expect(new Headers(call[1].headers).has("x-kilocode-organizationid")).toBe(false)
    expect(call[1].redirect).toBe("error")
    expect(call[1].signal).toBeInstanceOf(AbortSignal)
  })

  test("encodes query input", async () => {
    global.fetch = mock(() => Promise.resolve(result([]))) as unknown as typeof fetch
    await fetchByokEntries("token")
    const call = (global.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    const url = new URL(call[0])
    expect(url.pathname).toBe("/api/trpc/byok.list")
    expect(JSON.parse(url.searchParams.get("input") ?? "null")).toEqual({})
  })

  test("validates every supported procedure projection", async () => {
    const payloads: Record<string, unknown> = {
      "codingPlans.getUsage": {
        ...quota(),
        additive: "stripped",
        subscription: {
          ...quota().subscription,
          windows: quota().subscription.windows.map((window, index) =>
            index === 0 ? { ...window, providerPrivate: "stripped" } : window,
          ),
        },
      },
    }
    global.fetch = mock((input: string | URL | Request) => {
      const procedure = new URL(String(input)).pathname.split("/").at(-1) ?? ""
      return Promise.resolve(result(payloads[procedure]))
    }) as unknown as typeof fetch

    const usage = await fetchCodingPlanUsage("token", "plan")
    expect(usage).toEqual(quota())
    const call = (global.fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0]
    expect(JSON.parse(new URL(call[0]).searchParams.get("input") ?? "null")).toEqual({ subscriptionId: "plan" })
  })

  test("decodes procedure errors even when HTTP is successful", async () => {
    global.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { json: { message: "raw private error" } } }), { status: 200 }),
      ),
    ) as unknown as typeof fetch

    const error = await fetchCodingPlanSubscriptions("secret-token").catch((value) => value)
    expect(error).toBeInstanceOf(CloudTrpcError)
    expect(error).toMatchObject({ kind: "procedure", message: "Kilo Cloud data is temporarily unavailable." })
    // Include non-enumerable Error surfaces that JSON.stringify would omit.
    const surface = `${error.name} ${error.message} ${error.stack} ${JSON.stringify(error)}`
    expect(surface).not.toContain("raw private error")
    expect(surface).not.toContain("secret-token")
  })

  test("tolerates an explicit null error field in successful envelopes", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ result: { data: { json: [] } }, error: null }))),
    ) as unknown as typeof fetch

    await expect(fetchCodingPlanSubscriptions("token")).resolves.toEqual([])
  })

  test("maps malformed envelopes and schema failures safely", async () => {
    global.fetch = mock(() => Promise.resolve(new Response("not-json"))) as unknown as typeof fetch
    await expect(fetchCodingPlanSubscriptions("token")).rejects.toMatchObject({ kind: "protocol" })

    global.fetch = mock(() => Promise.resolve(result({ status: "unknown" }))) as unknown as typeof fetch
    await expect(fetchCodingPlanSubscriptions("token")).rejects.toMatchObject({ kind: "schema" })
  })

  test.each([
    ["unknown version", { schemaVersion: 2 }],
    ["mismatched subscription", quota("other")],
    [
      "duplicate windows",
      {
        ...quota(),
        subscription: {
          ...quota().subscription,
          windows: [quota().subscription.windows[1], quota().subscription.windows[1]],
        },
      },
    ],
    [
      "missing period",
      {
        ...quota(),
        subscription: {
          ...quota().subscription,
          windows: [{ ...quota().subscription.windows[1], period: undefined }],
        },
      },
    ],
  ])("rejects %s usage payloads", async (_description, payload) => {
    global.fetch = mock(() => Promise.resolve(result(payload))) as unknown as typeof fetch

    await expect(fetchCodingPlanUsage("token", "plan")).rejects.toMatchObject({ kind: "schema" })
  })
})
