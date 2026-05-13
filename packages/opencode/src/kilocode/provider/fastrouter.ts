// kilocode_change - new file
//
// FastRouter integration helpers.
//
// FastRouter (https://fastrouter.ai) is an OpenRouter-compatible AI gateway.
// We talk to it directly with the user's `FASTROUTER_API_KEY` — no Kilo
// gateway routing — and reuse the OpenRouter Vercel AI SDK since the wire
// format is identical.

export const FASTROUTER_API = "https://go.fastrouter.ai/api/v1"
export const FASTROUTER_MODELS_URL = `${FASTROUTER_API}/models`
export const FASTROUTER_ENV = "FASTROUTER_API_KEY"

const FETCH_TIMEOUT_MS = 10_000

type Pricing = { prompt?: string; completion?: string }
type Architecture = { input_modalities?: string[]; output_modalities?: string[] }
type Top = {
  id: string
  name?: string
  description?: string
  context_length?: number | null
  max_completion_tokens?: number | null
  pricing?: Pricing
  architecture?: Architecture
  supported_parameters?: string[]
  created?: number
}

type Models = { data?: Top[] }

type FastRouterModel = {
  id: string
  name: string
  family: string
  release_date: string
  attachment: boolean
  reasoning: boolean
  temperature: boolean
  tool_call: boolean
  cost: { input: number; output: number }
  limit: { context: number; output: number }
  options: Record<string, unknown>
  modalities: {
    input: Array<"text" | "audio" | "image" | "video" | "pdf">
    output: Array<"text" | "audio" | "image" | "video" | "pdf">
  }
}

export async function fetchFastRouterModels(): Promise<Record<string, FastRouterModel>> {
  // The /models endpoint is public — no Authorization header needed. We use
  // `globalThis.fetch` explicitly to avoid accidentally hitting any local
  // namespaced fetch helpers from the calling module.
  const res = await globalThis.fetch(FASTROUTER_MODELS_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) return {}

  const json = (await res.json()) as Models
  const out: Record<string, FastRouterModel> = {}

  for (const m of json.data ?? []) {
    if (!m.id) continue
    const inputs = m.architecture?.input_modalities ?? ["text"]
    const outputs = m.architecture?.output_modalities ?? ["text"]
    const params = m.supported_parameters ?? []

    out[m.id] = {
      id: m.id,
      name: m.name || m.id,
      family: m.id.split("/")[0] || "",
      // Use ISO date if `created` is a unix timestamp; else empty string.
      release_date: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : "",
      attachment: inputs.includes("image"),
      reasoning: params.includes("reasoning") || params.includes("include_reasoning"),
      temperature: params.includes("temperature"),
      tool_call: params.includes("tools") || params.includes("tool_choice"),
      // `||` (not `??`) — FastRouter returns 0/null/empty-string for unknown
      // pricing and limits; we want our defaults to apply in those cases too.
      cost: {
        input: parseFloat(m.pricing?.prompt || "0"),
        output: parseFloat(m.pricing?.completion || "0"),
      },
      limit: {
        context: m.context_length || 128_000,
        output: m.max_completion_tokens || 16_384,
      },
      options: {},
      modalities: {
        input: inputs.filter((x): x is "text" | "audio" | "image" | "video" | "pdf" =>
          ["text", "audio", "image", "video", "pdf"].includes(x),
        ),
        output: outputs.filter((x): x is "text" | "audio" | "image" | "video" | "pdf" =>
          ["text", "audio", "image", "video", "pdf"].includes(x),
        ),
      },
    }
  }

  return out
}
