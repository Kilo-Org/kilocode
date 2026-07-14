import { KILO_API_BASE } from "./api/constants.js"
import { getAutocompleteModel, type DirectAutocompleteProviderID } from "./autocomplete.js"

export { requestMistralFim } from "./mistral-fim-endpoint.js"

export const DIRECT_FIM_ENV: Record<DirectAutocompleteProviderID, string[]> = {
  mistral: ["MISTRAL_API_KEY"],
  inception: ["INCEPTION_API_KEY"],
  mtplx: ["MTPLX_API_KEY"],
}

export type FimTarget =
  | { provider: "kilo"; model: string; url: string }
  | { provider: "inception"; model: string; url: string }
  | { provider: "mistral"; model: string }
  | { provider: "mtplx"; model: string }

const KILO_FIM_URL = KILO_API_BASE + "/api/fim/completions"
const INCEPTION_FIM_URL = "https://api.inceptionlabs.ai/v1/fim/completions"
export const MTPLX_DEFAULT_BASE_URL = "http://127.0.0.1:8001/v1"

const MTPLX_SYSTEM_PROMPT =
  "You are an inline code-completion engine. Return only code inserted at the cursor. Never repeat any suffix text. No markdown or explanation."

export function mtplxChatUrl(baseURL = MTPLX_DEFAULT_BASE_URL) {
  return `${baseURL.replace(/\/+$/, "")}/chat/completions`
}

export function isLoopbackMtplxUrl(baseURL: string) {
  if (!URL.canParse(baseURL)) return false
  const hostname = new URL(baseURL).hostname
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
}

export function buildMtplxRequest(input: {
  model: string
  prefix: string
  suffix: string
  maxTokens: number
  temperature: number
}) {
  const stop = input.suffix.trimEnd().slice(0, 64)
  return {
    model: input.model,
    messages: [
      { role: "system", content: MTPLX_SYSTEM_PROMPT },
      {
        role: "user",
        content: `SUFFIX AFTER CURSOR:\n${input.suffix}\n\nPREFIX BEFORE CURSOR:\n${input.prefix}\n\nINSERT AT CURSOR:`,
      },
    ],
    max_tokens: Math.min(input.maxTokens, 64),
    temperature: input.temperature,
    stream: true,
    stream_options: { include_usage: true },
    enable_thinking: false,
    chat_template_kwargs: { enable_thinking: false },
    ...(stop ? { stop: [stop] } : {}),
  }
}

function kiloTarget(model?: string): FimTarget {
  return { provider: "kilo", model: model ?? "mistralai/codestral-2501", url: KILO_FIM_URL }
}

export function resolveFimTarget(provider?: string, model?: string): FimTarget {
  if (!provider || provider === "kilo") return kiloTarget(model)

  const info = getAutocompleteModel(provider, model)
  if (info.directProvider === "mistral") {
    return { provider: "mistral", model: info.requestModel }
  }
  if (info.directProvider === "inception") {
    return { provider: "inception", model: info.requestModel, url: INCEPTION_FIM_URL }
  }
  if (info.directProvider === "mtplx") {
    return { provider: "mtplx", model: info.requestModel }
  }
  return kiloTarget(model)
}
