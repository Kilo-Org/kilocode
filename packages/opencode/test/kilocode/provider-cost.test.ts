import { describe, expect, test } from "bun:test"
import { Usage } from "@opencode-ai/llm"
import { Session as SessionNs } from "@/session/session"
import type { Provider } from "@/provider/provider"

function createModel(opts: {
  context: number
  output: number
  input?: number
  cost?: Provider.Model["cost"]
  npm?: string
  providerID?: string
}): Provider.Model {
  return {
    id: "test-model",
    providerID: opts.providerID ?? "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: opts.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: opts.npm ?? "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

const baseUsage = new Usage({
  inputTokens: 1_000_000,
  outputTokens: 100_000,
  totalTokens: 1_100_000,
})

const model = () =>
  createModel({
    context: 100_000,
    output: 32_000,
    cost: { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
  })

const kilo = { id: "kilo" } as Provider.Info

// Calculated cost for the `model()` + `baseUsage` pair: 1M input * $3 + 100k output * $15 = 3 + 1.5
const fallback = 3 + 1.5

describe("KiloSession.providerCost — Anthropic Messages / OpenAI Responses", () => {
  test("uses preserved AI SDK raw usage cost_details", () => {
    const result = SessionNs.getUsage({
      model: model(),
      provider: kilo,
      usage: new Usage({
        inputTokens: baseUsage.inputTokens,
        outputTokens: baseUsage.outputTokens,
        totalTokens: baseUsage.totalTokens,
        providerMetadata: {
          aiSdk: {
            cost: 0.0439847,
            cost_details: { upstream_inference_cost: 0.879694 },
          },
        },
      }),
    })

    expect(result.cost).toBe(0.879694)
  })

  test("ignores provider `cost` when no upstream_inference_cost is reported", () => {
    const result = SessionNs.getUsage({
      model: model(),
      provider: kilo,
      usage: new Usage({
        inputTokens: baseUsage.inputTokens,
        outputTokens: baseUsage.outputTokens,
        totalTokens: baseUsage.totalTokens,
        providerMetadata: { aiSdk: { cost: 0.5 } },
      }),
    })

    expect(result.cost).toBe(fallback)
  })
})

describe("KiloSession.providerCost — Vercel AI Gateway", () => {
  test("uses metadata.gateway.marketCost", () => {
    const result = SessionNs.getUsage({
      model: model(),
      provider: kilo,
      usage: baseUsage,
      metadata: {
        gateway: {
          // Strings, exactly as emitted by the AI Gateway. `cost` is the gateway fee,
          // which Kilo doesn't pass on to end users — must be ignored.
          cost: "0",
          marketCost: "0.35349075",
        },
      },
    })

    expect(result.cost).toBe(0.35349075)
  })

  test("ignores metadata.gateway.cost when marketCost is missing", () => {
    const result = SessionNs.getUsage({
      model: model(),
      provider: kilo,
      usage: baseUsage,
      metadata: {
        gateway: {
          cost: "0.123",
        },
      },
    })

    expect(result.cost).toBe(fallback)
  })
})

describe("KiloSession.providerCost — OpenRouter chat completions", () => {
  const openrouterModel = () =>
    createModel({
      context: 100_000,
      output: 32_000,
      npm: "@openrouter/ai-sdk-provider",
      providerID: "openrouter",
    })

  test("uses upstream_inference_cost when OpenRouter reports $0 for BYOK routing", () => {
    const result = SessionNs.getUsage({
      model: openrouterModel(),
      usage: baseUsage,
      metadata: {
        openrouter: {
          usage: {
            // Raw OpenRouter payload for a BYOK key: { cost: 0, is_byok: true,
            // cost_details: { upstream_inference_cost: 0.00000445 } }. The AI SDK
            // normalizes cost_details -> costDetails. `cost` is what OpenRouter
            // charged the account ($0 by definition for BYOK); true spend is
            // upstream plus that account charge.
            cost: 0,
            costDetails: { upstreamInferenceCost: 0.00000445 },
          },
        },
      },
    })

    expect(result.cost).toBe(0.00000445)
  })

  test("adds upstream_inference_cost to the BYOK routing fee", () => {
    const result = SessionNs.getUsage({
      model: openrouterModel(),
      usage: baseUsage,
      metadata: {
        openrouter: {
          usage: {
            // Observed BYOK shape in kilo-gateway fixtures: `cost` is OpenRouter's
            // routing fee; upstream is billed to the user's own key. True spend is
            // the sum.
            cost: 0.0032093125,
            costDetails: { upstreamInferenceCost: 0.06418625 },
          },
        },
      },
    })

    expect(result.cost).toBe(0.0032093125 + 0.06418625)
  })

  test("keeps usage.cost for a non-BYOK OpenRouter response", () => {
    const result = SessionNs.getUsage({
      model: openrouterModel(),
      usage: baseUsage,
      metadata: {
        openrouter: {
          usage: {
            // Non-BYOK: `cost` is the full account charge (upstream + fee), the
            // value surfaced today. It must not change.
            cost: 0.0123,
            costDetails: { upstreamInferenceCost: 0.0117 },
          },
        },
      },
    })

    expect(result.cost).toBe(0.0123)
  })

  test("keeps usage.cost when no cost_details are reported", () => {
    const result = SessionNs.getUsage({
      model: openrouterModel(),
      usage: baseUsage,
      metadata: {
        openrouter: {
          usage: { cost: 0.0123 },
        },
      },
    })

    expect(result.cost).toBe(0.0123)
  })

  test("prefers upstream_inference_cost for the Kilo provider", () => {
    const result = SessionNs.getUsage({
      model: model(),
      provider: kilo,
      usage: baseUsage,
      metadata: {
        openrouter: {
          usage: {
            cost: 0.5,
            costDetails: { upstreamInferenceCost: 0.879694 },
          },
        },
      },
    })

    expect(result.cost).toBe(0.879694)
  })
})

describe("KiloSession.providerCost — fallback", () => {
  test("falls back to calculated cost when no provider cost is reported", () => {
    const result = SessionNs.getUsage({
      model: model(),
      provider: kilo,
      usage: baseUsage,
      // No metadata or provider usage cost — should fall back
    })

    expect(result.cost).toBe(fallback)
  })
})
