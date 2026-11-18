import { describe, expect, test } from "bun:test"
import { Usage } from "@opencode/ai/effect"
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
  test.each(["openrouter", "anthropic", "openai"])("uses the Kilo charge in usage.cost on the %s dialect", (key) => {
    const cost = (usage: Record<string, unknown>) =>
      KiloSessionUsage.providerCost(new Usage({ providerMetadata: { [key]: usage } }), "kilo")
    expect(cost({ cost: 0.25, is_byok: false, cost_details: { upstream_inference_cost: 0.2 } })).toBe(
      Money.USD.make(0.25),
    )
    expect(cost({ cost: 0, is_byok: false, cost_details: { upstream_inference_cost: 0.2 } })).toBe(Money.USD.zero)
    expect(cost({ cost: 0.25 })).toBe(Money.USD.make(0.25))
  })

  test("uses the upstream inference cost when the call ran on the user's own key", () => {
    const cost = (usage: Record<string, unknown>) =>
      KiloSessionUsage.providerCost(new Usage({ providerMetadata: { openrouter: usage } }), "kilo")
    expect(cost({ cost: 0, is_byok: true, cost_details: { upstream_inference_cost: 0.125 } })).toBe(
      Money.USD.make(0.125),
    )
    expect(cost({ cost: 0.01, is_byok: true, cost_details: { upstream_inference_cost: 0 } })).toBe(Money.USD.zero)
    expect(cost({ cost: 0.01, is_byok: true })).toBeUndefined()
  })

  test("ignores a Vercel market cost", () => {
    expect(
      KiloSessionUsage.providerCost(
        new Usage({ providerMetadata: { openai: { input_tokens: 10, gateway: { marketCost: "0.3", cost: "0.01" } } } }),
        "kilo",
      ),
    ).toBeUndefined()
  })

  test.each([undefined, null, "0.1", -0.5, Number.NaN, Infinity, {}, [], true].map((value) => [value]))(
    "falls back to token pricing for malformed costs: %j",
    (value) => {
      const usage = new Usage({
        nonCachedInputTokens: 1_000_000,
        outputTokens: 150_000,
        reasoningTokens: 50_000,
        cacheReadInputTokens: 200_000,
        cacheWriteInputTokens: 100_000,
        providerMetadata: {
          openrouter: { cost: value, cost_details: { upstream_inference_cost: value } },
        },
      })
      expect(SessionUsage.record(usage, prices, "kilo")).toEqual({
        tokens: { input: 1_000_000, output: 100_000, reasoning: 50_000, cache: { read: 200_000, write: 100_000 } },
        cost: Money.USD.make(2.8),
      })
    },
  )

  test("keeps token accounting for other providers", () => {
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
