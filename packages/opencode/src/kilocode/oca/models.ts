import { Log } from "../../util/log"
import { OCA_BASE_URL, OCA_MODELS_TIMEOUT_MS } from "./constants"

const log = Log.create({ service: "oca-models" })

function headers(token?: string): Record<string, string> {
  const result: Record<string, string> = {
    "Content-Type": "application/json",
    client: "kilocode-cli",
    "client-version": "1.0.0",
  }
  if (token) result["Authorization"] = `Bearer ${token}`
  return result
}

function parsePrice(raw: string | number | null | undefined): number | undefined {
  if (raw == null) return undefined
  const parsed = typeof raw === "number" ? raw : parseFloat(raw)
  if (isNaN(parsed)) return undefined
  return parsed * 1_000_000
}

function extractFamily(id: string): string | undefined {
  const lower = id.toLowerCase()
  if (lower.includes("claude")) return "claude"
  if (lower.includes("gpt")) return "gpt"
  if (lower.includes("gemini")) return "gemini"
  if (lower.includes("llama")) return "llama"
  if (lower.includes("mistral")) return "mistral"
  if (lower.includes("cohere")) return "cohere"
  return undefined
}

function transform(entry: any, baseURL: string): [string, any] | undefined {
  const id = entry.litellm_params?.model
  if (!id) return undefined

  const info = entry.model_info ?? {}
  const supported: string[] = info.supported_api_list ?? []

  const chat = supported.includes("CHAT_COMPLETIONS")
  const responses = supported.includes("RESPONSES")
  if (!chat && !responses) return undefined

  const vision = info.supports_vision === true
  const reasoning = info.is_reasoning_model === true
  const context = info.context_window ?? 128000
  const output = entry.litellm_params?.max_tokens ?? Math.ceil(context * 0.2)

  const input = parsePrice(info.input_price)
  const outputCost = parsePrice(info.output_price)
  const cacheWrite = parsePrice(info.caching_price)
  const cacheRead = parsePrice(info.cached_price)

  const cost =
    input !== undefined && outputCost !== undefined
      ? {
          input,
          output: outputCost,
          ...(cacheRead !== undefined && { cache_read: cacheRead }),
          ...(cacheWrite !== undefined && { cache_write: cacheWrite }),
        }
      : undefined

  const model = {
    id,
    name: info.description ?? id,
    family: extractFamily(id),
    release_date: new Date().toISOString().split("T")[0],
    attachment: vision,
    reasoning,
    temperature: !reasoning,
    tool_call: true,
    ...(cost && { cost }),
    limit: {
      context,
      output,
    },
    modalities: {
      input: vision ? (["text", "image"] as const) : (["text"] as const),
      output: ["text"] as const,
    },
    options: {
      ...(info.banner && { description: info.banner }),
      ...(reasoning && info.reasoning_effort_options && { reasoning_effort_options: info.reasoning_effort_options }),
    },
    provider: {
      npm: "@ai-sdk/openai",
      api: baseURL,
    },
  }

  return [id, model]
}

export async function fetchOcaModels(options?: { baseURL?: string; token?: string }): Promise<Record<string, any>> {
  const base = options?.baseURL ?? OCA_BASE_URL
  const url = `${base}/v1/model/info`

  const response = await fetch(url, {
    headers: headers(options?.token),
    signal: AbortSignal.timeout(OCA_MODELS_TIMEOUT_MS),
  }).catch((err) => {
    log.error("failed to fetch OCA models", { error: err })
    return undefined
  })

  if (!response) return {}

  if (!response.ok) {
    log.error("OCA models endpoint returned error", { status: response.status })
    return {}
  }

  const json = await response.json().catch((err) => {
    log.error("failed to parse OCA models response", { error: err })
    return undefined
  })

  if (!json) return {}

  const data: any[] = json.data ?? []
  const models: Record<string, any> = {}

  for (const entry of data) {
    const pair = transform(entry, base)
    if (!pair) continue
    models[pair[0]] = pair[1]
  }

  log.info("fetched OCA models", { count: Object.keys(models).length })
  return models
}
