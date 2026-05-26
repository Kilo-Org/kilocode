import { describe, it, expect, afterEach } from "bun:test"
import {
  fetchOrcaRouterModels,
  ORCAROUTER_PRICING_URL,
} from "../../src/kilocode/provider/orcarouter"

const ORIGINAL_FETCH = globalThis.fetch

function mockPricingFetch(entries: unknown[], init: { ok?: boolean } = {}) {
  const ok = init.ok ?? true
  // The live /api/pricing endpoint wraps the model list in a `{ data: [...] }`
  // envelope along with other workspace fields. Mirror that here so tests
  // exercise the same parsing path as production.
  const payload = { data: entries, success: true }
  globalThis.fetch = (async (input: any) => {
    if (input === ORCAROUTER_PRICING_URL) {
      return new Response(JSON.stringify(payload), {
        status: ok ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      })
    }
    throw new Error(`Unexpected fetch URL: ${String(input)}`)
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

describe("fetchOrcaRouterModels", () => {
  it("transforms a /api/pricing entry into a Kilo model with correct cost formula", async () => {
    mockPricingFetch([
      {
        model_name: "openai/gpt-4o",
        model_ratio: 1.25,
        completion_ratio: 4,
        cache_ratio: 0.1,
        context_length: 128000,
        max_completion_tokens: 16384,
        supported_endpoint_types: ["openai"],
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        supported_parameters: ["temperature", "tools"],
      },
    ])

    const result = await fetchOrcaRouterModels()
    const model = result["openai/gpt-4o"]

    expect(model).toBeDefined()
    // Section 11 of OrcaRouter shared notes: ratio * 2 = USD per 1M tokens.
    expect(model.cost.input).toBeCloseTo(2.5)
    expect(model.cost.output).toBeCloseTo(10.0)
    expect(model.cost.cache_read).toBeCloseTo(0.25)
    expect(model.temperature).toBe(true)
    expect(model.tool_call).toBe(true)
    expect(model.attachment).toBe(true)
    expect(model.reasoning).toBe(false)
    expect(model.family).toBe("openai")
    expect(model.limit.context).toBe(128000)
    expect(model.limit.output).toBe(16384)
    expect(model.modalities.input).toEqual(["text", "image"])
    expect(model.modalities.output).toEqual(["text"])
  })

  it("computes cache_write for Anthropic models with create_cache_ratio", async () => {
    mockPricingFetch([
      {
        model_name: "anthropic/claude-sonnet-4.6",
        model_ratio: 1.5,
        completion_ratio: 5,
        cache_ratio: 0.1,
        create_cache_ratio: 1.25,
        supported_endpoint_types: ["openai"],
        supported_parameters: ["temperature", "tools"],
      },
    ])

    const result = await fetchOrcaRouterModels()
    const model = result["anthropic/claude-sonnet-4.6"]

    expect(model.cost.input).toBeCloseTo(3.0) // 1.5 * 2
    expect(model.cost.output).toBeCloseTo(15.0) // 1.5 * 5 * 2
    expect(model.cost.cache_read).toBeCloseTo(0.3) // 1.5 * 0.1 * 2
    expect(model.cost.cache_write).toBeCloseTo(3.75) // 1.5 * 1.25 * 2
  })

  it("filters out non-chat models", async () => {
    mockPricingFetch([
      // image generation
      { model_name: "openai/dall-e-3", supported_endpoint_types: ["image-generation"], model_ratio: 1 },
      { model_name: "openai/gpt-image-1", supported_endpoint_types: ["image-generation"], model_ratio: 1 },
      { model_name: "google/imagen-4.0-generate-001", supported_endpoint_types: ["openai"], model_ratio: 1 },
      // video
      { model_name: "kling/kling-v2-6", supported_endpoint_types: ["openai-video"], model_ratio: 1 },
      {
        model_name: "byteplus/dreamina-seedance-2-0-260128",
        supported_endpoint_types: ["openai-video"],
        model_ratio: 1,
      },
      // embeddings / TTS / STT
      {
        model_name: "openai/text-embedding-3-large",
        supported_endpoint_types: ["openai"],
        model_ratio: 0.1,
      },
      { model_name: "openai/tts-1", supported_endpoint_types: ["openai"], model_ratio: 1 },
      { model_name: "openai/whisper-1", supported_endpoint_types: ["openai"], model_ratio: 1 },
      // responses-only / completions-only
      {
        model_name: "openai/gpt-5-codex",
        supported_endpoint_types: ["openai-response"],
        model_ratio: 1,
      },
      {
        model_name: "openai/gpt-5-pro",
        supported_endpoint_types: ["openai-response"],
        model_ratio: 1,
      },
      // a real chat model — should survive
      {
        model_name: "openai/gpt-4o",
        supported_endpoint_types: ["openai"],
        model_ratio: 1,
        supported_parameters: ["temperature"],
      },
    ])

    const result = await fetchOrcaRouterModels()
    const realChatKeys = Object.keys(result).filter((k) => k !== "auto")
    expect(realChatKeys).toEqual(["openai/gpt-4o"])
  })

  it("hard-overrides temperature for Claude Opus 4.6/4.7 and OpenAI o*/gpt-5 families", async () => {
    mockPricingFetch([
      {
        model_name: "anthropic/claude-opus-4.7",
        model_ratio: 2.5,
        completion_ratio: 5,
        supported_endpoint_types: ["openai"],
        supported_parameters: ["temperature", "tools"],
      },
      {
        model_name: "anthropic/claude-opus-4.6",
        model_ratio: 2.5,
        completion_ratio: 5,
        supported_endpoint_types: ["openai"],
        supported_parameters: ["temperature", "tools"],
      },
      {
        model_name: "openai/gpt-5",
        model_ratio: 0.625,
        completion_ratio: 8,
        supported_endpoint_types: ["openai"],
        supported_parameters: ["temperature", "tools"],
      },
      {
        model_name: "openai/o3-mini",
        model_ratio: 1.1,
        completion_ratio: 4,
        supported_endpoint_types: ["openai"],
        supported_parameters: ["temperature"],
      },
      // Sanity: a non-reasoning model still gets temperature=true when advertised.
      {
        model_name: "anthropic/claude-haiku-4.6",
        model_ratio: 0.5,
        completion_ratio: 5,
        supported_endpoint_types: ["openai"],
        supported_parameters: ["temperature", "tools"],
      },
    ])

    const result = await fetchOrcaRouterModels()

    expect(result["anthropic/claude-opus-4.7"].temperature).toBe(false)
    expect(result["anthropic/claude-opus-4.6"].temperature).toBe(false)
    expect(result["openai/gpt-5"].temperature).toBe(false)
    expect(result["openai/o3-mini"].temperature).toBe(false)
    expect(result["anthropic/claude-haiku-4.6"].temperature).toBe(true)
  })

  it("detects reasoning models by family pattern when supported_parameters is silent", async () => {
    mockPricingFetch([
      {
        model_name: "openai/o3",
        supported_endpoint_types: ["openai"],
        model_ratio: 1,
        supported_parameters: [],
      },
      {
        model_name: "openai/gpt-5",
        supported_endpoint_types: ["openai"],
        model_ratio: 1,
        supported_parameters: [],
      },
      {
        model_name: "anthropic/claude-opus-4.7",
        supported_endpoint_types: ["openai"],
        model_ratio: 1,
        supported_parameters: [],
      },
      {
        model_name: "deepseek/deepseek-reasoner",
        supported_endpoint_types: ["openai"],
        model_ratio: 1,
        supported_parameters: [],
      },
      {
        model_name: "google/gemini-2.5-pro",
        supported_endpoint_types: ["openai"],
        model_ratio: 1,
        supported_parameters: [],
      },
      // Non-reasoning models — should stay false.
      {
        model_name: "openai/gpt-4o",
        supported_endpoint_types: ["openai"],
        model_ratio: 1,
        supported_parameters: [],
      },
      {
        model_name: "deepseek/deepseek-chat",
        supported_endpoint_types: ["openai"],
        model_ratio: 1,
        supported_parameters: [],
      },
    ])

    const result = await fetchOrcaRouterModels()

    expect(result["openai/o3"].reasoning).toBe(true)
    expect(result["openai/gpt-5"].reasoning).toBe(true)
    expect(result["anthropic/claude-opus-4.7"].reasoning).toBe(true)
    expect(result["deepseek/deepseek-reasoner"].reasoning).toBe(true)
    expect(result["google/gemini-2.5-pro"].reasoning).toBe(true)
    expect(result["openai/gpt-4o"].reasoning).toBe(false)
    expect(result["deepseek/deepseek-chat"].reasoning).toBe(false)
  })

  it("adds orcarouter/auto as a synthetic catalog entry keyed by 'auto'", async () => {
    mockPricingFetch([])

    const result = await fetchOrcaRouterModels()
    const auto = result["auto"]

    expect(auto).toBeDefined()
    expect(auto.id).toBe("auto")
    expect(auto.name).toBe("OrcaRouter Auto")
    expect(auto.family).toBe("orcarouter")
    expect(auto.tool_call).toBe(true)
    expect(auto.modalities.input).toContain("image")
  })

  it("returns empty object when /api/pricing returns a non-OK response", async () => {
    mockPricingFetch([], { ok: false })
    const result = await fetchOrcaRouterModels()
    expect(result).toEqual({})
  })

  it("skips entries with missing model_name without throwing", async () => {
    mockPricingFetch([
      { model_ratio: 1 }, // no model_name
      {
        model_name: "openai/gpt-4o",
        supported_endpoint_types: ["openai"],
        model_ratio: 1,
        supported_parameters: ["temperature"],
      },
    ])

    const result = await fetchOrcaRouterModels()
    expect(result["openai/gpt-4o"]).toBeDefined()
  })
})
