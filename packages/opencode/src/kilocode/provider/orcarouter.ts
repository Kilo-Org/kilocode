// kilocode_change - new file
//
// OrcaRouter integration helpers.
//
// OrcaRouter (https://www.orcarouter.ai) is an OpenAI-compatible API gateway
// that routes requests to OpenAI, Anthropic, Google Gemini, DeepSeek, xAI
// Grok, Alibaba Qwen, Moonshot Kimi, MiniMax, and Z.ai at provider cost
// price. We talk to it directly with the user's `ORCAROUTER_API_KEY` — no
// Kilo gateway routing.
//
// OrcaRouter speaks the OpenAI wire shape (flat `reasoning_effort`, not
// OpenRouter's nested `reasoning: {effort}` block), so we reuse
// `@ai-sdk/openai-compatible` rather than the OpenRouter SDK.

export const ORCAROUTER_API = "https://api.orcarouter.ai/v1"
export const ORCAROUTER_PRICING_URL = "https://www.orcarouter.ai/api/pricing"
export const ORCAROUTER_ENV = "ORCAROUTER_API_KEY"

const FETCH_TIMEOUT_MS = 10_000

// 1 OrcaRouter quota unit = $0.000002, i.e. ratio * 2 = USD per million tokens.
// Source: OrcaRouter-O2 common/constants.go QuotaPerUnit = 500 * 1000.0.
const QUOTA_USD_PER_1M = 2

type PricingEntry = {
  model_name: string
  model_ratio?: number
  completion_ratio?: number
  cache_ratio?: number
  create_cache_ratio?: number
  context_length?: number
  max_completion_tokens?: number
  supported_endpoint_types?: string[]
  input_modalities?: string[]
  output_modalities?: string[]
  supported_parameters?: string[]
}

type OrcaRouterModel = {
  id: string
  name: string
  family: string
  release_date: string
  attachment: boolean
  reasoning: boolean
  temperature: boolean
  tool_call: boolean
  cost: { input: number; output: number; cache_read?: number; cache_write?: number }
  limit: { context: number; output: number }
  options: Record<string, unknown>
  modalities: {
    input: Array<"text" | "audio" | "image" | "video" | "pdf">
    output: Array<"text" | "audio" | "image" | "video" | "pdf">
  }
}

// Skip non-chat models: image/video generation, embedding, TTS, STT, rerank,
// and models that only respond on `/v1/responses` or `/v1/completions` rather
// than chat completions. Kilo Code's picker is chat-only.
function isChatModel(entry: PricingEntry): boolean {
  const name = entry.model_name.toLowerCase()
  const eps = new Set(entry.supported_endpoint_types ?? [])

  if (eps.has("image-generation") || eps.has("openai-video")) return false
  if ((entry.output_modalities ?? []).includes("image")) return false
  if (/imagen|dall-e|gpt-image|grok-imagine/.test(name)) return false

  if (/embedding|tts|whisper|transcrib|rerank/.test(name)) return false
  if (name.endsWith("-speech")) return false

  // Responses-only or completions-only families
  if (eps.has("openai-response") && !eps.has("openai")) return false
  if (/codex/.test(name)) return false
  if (/^openai\/gpt-5(\.\d+)?-pro/.test(name)) return false

  // Video namespaces
  if (name.startsWith("kling/") || name.startsWith("byteplus/")) return false

  return true
}

function isReasoningModel(name: string, params: Set<string>): boolean {
  if (params.has("reasoning_effort") || params.has("reasoning")) return true
  const lower = name.toLowerCase()
  if (/^openai\/(o\d|gpt-5)/.test(lower)) return true
  if (/^anthropic\/claude-(sonnet|opus)-4/.test(lower)) return true
  if (/^deepseek\/.*-reasoner/.test(lower)) return true
  if (/^grok\/.*-reasoning/.test(lower)) return true
  if (/^qwen\/.*-thinking/.test(lower)) return true
  if (/^google\/gemini-(2\.5|3)/.test(lower)) return true
  if (/-(thinking|reasoner)$/.test(lower)) return true
  return false
}

// /api/pricing advertises `temperature` for some reasoning models but the
// upstream rejects it at request time. Hardcode the known offenders so the
// Kilo `temperature` UI matches actual API behaviour.
const TEMPERATURE_BLACKLIST_EXACT = new Set<string>([
  "anthropic/claude-opus-4.6",
  "anthropic/claude-opus-4.7",
])
function temperatureRejectedByFamily(name: string): boolean {
  return /^openai\/(o\d|gpt-5)/.test(name)
}

function pickModalities(values: string[] | undefined): Array<"text" | "audio" | "image" | "video" | "pdf"> {
  const allowed = new Set(["text", "audio", "image", "video", "pdf"])
  const filtered = (values ?? ["text"]).filter((x) => allowed.has(x)) as Array<
    "text" | "audio" | "image" | "video" | "pdf"
  >
  return filtered.length ? filtered : ["text"]
}

export async function fetchOrcaRouterModels(): Promise<Record<string, OrcaRouterModel>> {
  // /api/pricing is a public endpoint — no Authorization header required.
  // The response is a `{ data: PricingEntry[], ... }` envelope — never assume a bare array.
  const res = await globalThis.fetch(ORCAROUTER_PRICING_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) return {}

  const json = (await res.json()) as { data?: PricingEntry[] }
  const entries = Array.isArray(json?.data) ? json.data : []
  const out: Record<string, OrcaRouterModel> = {}

  for (const entry of entries) {
    if (!entry.model_name) continue
    if (!isChatModel(entry)) continue

    const name = entry.model_name
    const params = new Set(entry.supported_parameters ?? [])
    const reasoning = isReasoningModel(name, params)
    const temperature =
      !TEMPERATURE_BLACKLIST_EXACT.has(name) &&
      !temperatureRejectedByFamily(name) &&
      params.has("temperature")

    const ratio = entry.model_ratio ?? 0
    const completionRatio = entry.completion_ratio ?? 1
    const cacheRatio = entry.cache_ratio ?? 0
    const createCacheRatio = entry.create_cache_ratio

    const cost: OrcaRouterModel["cost"] = {
      input: ratio * QUOTA_USD_PER_1M,
      output: ratio * completionRatio * QUOTA_USD_PER_1M,
    }
    if (cacheRatio > 0) cost.cache_read = ratio * cacheRatio * QUOTA_USD_PER_1M
    if (typeof createCacheRatio === "number" && createCacheRatio > 0) {
      cost.cache_write = ratio * createCacheRatio * QUOTA_USD_PER_1M
    }

    const inputModalities = pickModalities(entry.input_modalities)
    const outputModalities = pickModalities(entry.output_modalities)

    out[name] = {
      id: name,
      name,
      family: name.split("/")[0] || "",
      release_date: "",
      attachment: inputModalities.includes("image"),
      reasoning,
      temperature,
      tool_call: params.has("tools") || params.has("tool_choice"),
      cost,
      limit: {
        context: entry.context_length ?? 128_000,
        output: entry.max_completion_tokens ?? 16_384,
      },
      options: {},
      modalities: { input: inputModalities, output: outputModalities },
    }
  }

  // `orcarouter/auto` is OrcaRouter's seeded "named router" — every account
  // gets one on signup. It picks the cheapest live model per request. The
  // router is not exposed by /api/pricing, so add it manually. Cost and
  // limits are nominal; the routed pick supplies real numbers.
  //
  // We key it as `auto` (not `orcarouter/auto`) because Kilo splits the
  // user-facing `orcarouter/auto` ref on the first `/` and looks up the
  // remainder. The custom loader's `getModel` hook prefixes it back to
  // `orcarouter/auto` for the SDK call so OrcaRouter's backend resolves
  // the named router correctly.
  out["auto"] = {
    id: "auto",
    name: "OrcaRouter Auto",
    family: "orcarouter",
    release_date: "",
    attachment: true,
    reasoning: false,
    temperature: true,
    tool_call: true,
    cost: { input: 0, output: 0 },
    limit: { context: 128_000, output: 16_384 },
    options: {},
    modalities: { input: ["text", "image"], output: ["text"] },
  }

  return out
}
