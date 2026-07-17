import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  CloudTrpcError,
  getAutoTopUpState,
  getCodingPlanUsage,
  listByokEntries,
  listCodingPlanSubscriptions,
} from "../../src/api/trpc"

const original = global.fetch

const result = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ result: { data: { json: data } } }), {
    status,
    headers: { "content-type": "application/json" },
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
            id: "subscription",
            planId: "minimax-token-plan-plus",
            planName: "Token Plan Plus",
            providerName: "MiniMax",
            providerId: "minimax",
            routeLabel: "MiniMax via Kilo Gateway",
            hasInstalledByokKey: true,
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
            additive: "ignored",
          },
        ]),
      ),
    )
    global.fetch = fn as unknown as typeof fetch

    const subscriptions = await listCodingPlanSubscriptions("secret-token")

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

  test("encodes query input and strips sensitive auto-top-up fields", async () => {
    const fn = mock(() =>
      Promise.resolve(
        result({
          enabled: true,
          amountCents: 5000,
          thresholdCents: 500,
          paymentMethod: {
            type: "card",
            brand: "visa",
            last4: "4242",
            stripePaymentMethodId: "pm_secret",
            linkEmail: "private@example.com",
          },
        }),
      ),
    )
    global.fetch = fn as unknown as typeof fetch

    const state = await getAutoTopUpState("token")
    expect(state).toEqual({
      enabled: true,
      amountCents: 5000,
      thresholdCents: 500,
      paymentMethod: { type: "card", brand: "visa", last4: "4242" },
    })

    global.fetch = mock(() => Promise.resolve(result([]))) as unknown as typeof fetch
    await listByokEntries("token")
    const call = (global.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    const url = new URL(call[0])
    expect(url.pathname).toBe("/api/trpc/byok.list")
    expect(JSON.parse(url.searchParams.get("input") ?? "null")).toEqual({})
  })

  test("validates every supported procedure projection", async () => {
    const payloads: Record<string, unknown> = {
      "codingPlans.getUsage": {
        subscriptionId: "plan",
        providerId: "minimax",
        region: "global",
        fetchedAt: "2026-06-19T00:00:00.000Z",
        native: {
          base_resp: { status_code: 0, status_msg: "stripped" },
          model_remains: [
            {
              model_name: "general",
              current_interval_remaining_percent: 80,
              current_interval_status: 1,
              end_time: 1_781_280_000_000,
            },
          ],
        },
      },
    }
    global.fetch = mock((input: string | URL | Request) => {
      const procedure = new URL(String(input)).pathname.split("/").at(-1) ?? ""
      return Promise.resolve(result(payloads[procedure]))
    }) as unknown as typeof fetch

    const usage = await getCodingPlanUsage("token", "plan")
    expect(usage.native.base_resp).toEqual({ status_code: 0 })
    const call = (global.fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0]
    expect(JSON.parse(new URL(call[0]).searchParams.get("input") ?? "null")).toEqual({ subscriptionId: "plan" })
  })

  test("decodes procedure errors even when HTTP is successful", async () => {
    global.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { json: { message: "raw private error" } } }), { status: 200 }),
      ),
    ) as unknown as typeof fetch

    const error = await getAutoTopUpState("secret-token").catch((value) => value)
    expect(error).toBeInstanceOf(CloudTrpcError)
    expect(error).toMatchObject({ kind: "procedure", message: "Kilo Cloud data is temporarily unavailable." })
    expect(JSON.stringify(error)).not.toContain("raw private error")
    expect(JSON.stringify(error)).not.toContain("secret-token")
  })

  test("maps malformed envelopes and schema failures safely", async () => {
    global.fetch = mock(() => Promise.resolve(new Response("not-json"))) as unknown as typeof fetch
    await expect(getAutoTopUpState("token")).rejects.toMatchObject({ kind: "protocol" })

    global.fetch = mock(() =>
      Promise.resolve(result({ enabled: "unknown" })),
    ) as unknown as typeof fetch
    await expect(getAutoTopUpState("token")).rejects.toMatchObject({ kind: "schema" })
  })
})
