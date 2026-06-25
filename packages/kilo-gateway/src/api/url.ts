import { KILO_API_BASE } from "./constants.js"
import { getKiloUrlFromToken } from "../auth/token.js"

type UrlOptions = {
  baseURL?: string
  token?: string
}

/**
 * Resolve the gateway URL for a request.
 *
 * Relay's gateway is OpenAI-compatible (LiteLLM). All AI requests go through
 * `${gateway}/v1` regardless of which provider (Anthropic/Gemini/Moonshot)
 * ends up handling them — LiteLLM does the internal routing per its
 * config.yaml.
 *
 * The legacy "gateway" vs "openrouter" path distinction used by Kilo Code
 * (`/api/gateway` for embeddings, `/api/openrouter` for chat) is collapsed
 * here: both helpers now return the same `${base}/v1` URL. The two function
 * names are preserved so we don't churn ~20 importers; the SDK pieces that
 * care (embeddings, chat) hit different endpoints under `/v1/` anyway.
 */
function base(options: UrlOptions): string {
  const raw = getKiloUrlFromToken(options.baseURL ?? KILO_API_BASE, options.token ?? "")
  const url = new URL(raw)
  url.pathname = url.pathname.replace(/\/+$/, "")
  url.search = ""
  url.hash = ""
  return url.toString()
}

function v1(raw: string): string {
  // Strip any trailing /v1 the caller already appended, then re-add it.
  // LiteLLM exposes /v1/chat/completions, /v1/embeddings, /v1/models.
  const normalized = raw.replace(/\/v1\/?$/, "").replace(/\/+$/, "")
  return `${normalized}/v1`
}

export function resolveKiloGatewayBaseUrl(options: UrlOptions = {}): string {
  return v1(base(options))
}

export function resolveKiloOpenRouterBaseUrl(options: UrlOptions = {}): string {
  return v1(base(options))
}
