import { describe, expect, test } from "bun:test"
import { Usage } from "@opencode/ai"
import { Money } from "@opencode/schema/money"
import { KiloSessionUsage } from "../../src/kilocode/session/usage.js"
import { SessionUsage } from "../../src/session/usage.js"

const prices = [
  {
    input: Money.USDPerMillionTokens.make(2),
    output: Money.USDPerMillionTokens.make(4),
    cache: { read: Money.USDPerMillionTokens.make(0.5), write: Money.USDPerMillionTokens.make(1) },
  },
]

describe("Gateway settlement", () => {
  test("prefers normalized upstream inference cost, including zero, over billed fees and raw transports", () => {
    const usage = new Usage({ providerMetadata: { aiSdk: { cost_details: { upstream_inference_cost: 5 } } } })
    expect(
      KiloSessionUsage.providerCost(usage, "kilo", {
        openrouter: { usage: { cost: 0.1, costDetails: { upstreamInferenceCost: "2.5" } } },
        gateway: { marketCost: "9" },
      }),
    ).toBe(Money.USD.make(2.5))
    expect(
      KiloSessionUsage.providerCost(usage, "kilo", {
        openrouter: { usage: { cost: 0.1, costDetails: { upstreamInferenceCost: 0 } } },
      }),
    ).toBe(Money.USD.zero)
    expect(
      KiloSessionUsage.providerCost(usage, "kilo", {
        openrouter: { usage: { cost: 0, costDetails: { upstreamInferenceCost: "invalid" } } },
      }),
    ).toBe(Money.USD.zero)
  })

  test("uses raw OpenRouter upstream cost for Auto/BYOK instead of its zero routing fee", () => {
    expect(
      SessionUsage.record(
        new Usage({
          providerMetadata: {
            openrouter: { cost: 0, cost_details: { upstream_inference_cost: "0.125" }, gateway: { marketCost: 8 } },
          },
        }),
        prices,
        "kilo",
      ).cost,
    ).toBe(Money.USD.make(0.125))
    expect(
      SessionUsage.record(
        new Usage({
          providerMetadata: {
            openrouter: { cost: "0.01" },
          },
        }),
        prices,
        "kilo",
      ).cost,
    ).toBe(Money.USD.make(0.01))
  })

  test.each([
    { normalized: { is_byok: true }, raw: { cost: "0.25" }, expected: 0.25 },
    { normalized: { cost: "invalid" }, raw: { cost: 0 }, expected: 0 },
    { normalized: { cost: 0 }, raw: { cost: 4, cost_details: { upstream_inference_cost: 7 } }, expected: 0 },
  ])("retains raw OpenRouter costs with partial normalized metadata: %j", ({ normalized, raw, expected }) => {
    expect(
      KiloSessionUsage.providerCost(new Usage({ providerMetadata: { openrouter: raw } }), "kilo", {
        openrouter: { usage: normalized },
        gateway: { marketCost: 9 },
      }),
    ).toBe(Money.USD.make(expected))
  })

  test("prefers raw native upstream inference cost over Gateway market cost and ignores the Gateway fee", () => {
    expect(
      SessionUsage.record(
        new Usage({
          providerMetadata: {
            anthropic: {
              cost: 0.01,
              cost_details: { upstream_inference_cost: "0.2" },
              gateway: { marketCost: "0.3", cost: "0.01" },
            },
          },
        }),
        prices,
        "kilo",
      ).cost,
    ).toBe(Money.USD.make(0.2))
    expect(
      SessionUsage.record(
        new Usage({
          providerMetadata: {
            openai: { gateway: { marketCost: "0", cost: "0.01" } },
          },
        }),
        prices,
        "kilo",
      ).cost,
    ).toBe(Money.USD.zero)
  })

  test.each([undefined, null, "invalid", Number.NaN, Infinity, {}, [], true].map((value) => [value]))(
    "falls back to token pricing for malformed costs: %j",
    (value) => {
      const usage = new Usage({
        nonCachedInputTokens: 1_000_000,
        outputTokens: 150_000,
        reasoningTokens: 50_000,
        cacheReadInputTokens: 200_000,
        cacheWriteInputTokens: 100_000,
        providerMetadata: {
          openrouter: { cost: value, cost_details: { upstream_inference_cost: value }, gateway: { marketCost: value } },
        },
      })
      expect(SessionUsage.record(usage, prices, "kilo")).toEqual({
        tokens: { input: 1_000_000, output: 100_000, reasoning: 50_000, cache: { read: 200_000, write: 100_000 } },
        cost: Money.USD.make(2.8),
      })
    },
  )

  test("retains main's finite numeric conversion and non-Kilo token accounting", () => {
    for (const value of [0, "0", "", " ", -0.5, "-0.5"]) {
      expect(
        KiloSessionUsage.providerCost(
          new Usage({
            providerMetadata: {
              openrouter: { cost_details: { upstream_inference_cost: value } },
            },
          }),
          "kilo",
        ),
      ).toBe(Money.USD.make(Math.max(0, Number(value))))
    }
    const usage = new Usage({
      nonCachedInputTokens: 1_000_000,
      providerMetadata: {
        openrouter: { cost: 99, cost_details: { upstream_inference_cost: 42 } },
      },
    })
    expect(SessionUsage.record(usage, prices, "openrouter").cost).toBe(Money.USD.make(2))
    expect(SessionUsage.record(usage, prices).cost).toBe(Money.USD.make(2))
  })

  test("persists only namespaced response identity, not raw usage or Gateway envelopes", () => {
    const usage = new Usage({
      providerMetadata: {
        openrouter: {
          routedModelID: "vendor/actual",
          vercelID: "fixture-request",
          cost: 2,
          gateway: { routing: { canonicalSlug: "vendor/actual" }, marketCost: 3 },
        },
      },
    })
    expect(KiloSessionUsage.native(usage, "kilo", { stopReason: "stop" })).toEqual({
      stopReason: "stop",
      kilo: { routedModelID: "vendor/actual", vercelID: "fixture-request" },
    })
    expect(KiloSessionUsage.native(usage, "openai", { stopReason: "stop" })).toEqual({ stopReason: "stop" })
  })
})
