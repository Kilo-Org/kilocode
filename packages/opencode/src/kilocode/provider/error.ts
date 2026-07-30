import type { APICallError } from "ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { isRecord } from "@/util/record"

export type Frame = {
  type?: unknown
  error?: Record<string, unknown>
} & Record<string, unknown>

/**
 * Normalize provider stream error frames that arrive without the
 * `{ type: "error" }` envelope expected by ProviderError.parseStreamError:
 * OpenAI Responses API terminal frames forwarded by @ai-sdk/openai >= 3.0.82
 * (`{ type: "response.failed", response: { error } }`), envelope-less
 * chat-completions wrappers (`{ error: { code, message } }`), and bare
 * error objects (`{ code, message }`). A nested `error` record wins over
 * bare top-level fields so gateway wrappers keep the specific inner code.
 */
export function frame(body: unknown): Frame {
  if (!isRecord(body)) return {}
  if (body.type === "response.failed" && isRecord(body.response) && isRecord(body.response.error)) {
    return { type: "error", error: body.response.error }
  }
  if (body.type === undefined && isRecord(body.error)) {
    return { ...body, type: "error" }
  }
  if (body.type === undefined && typeof body.message === "string" && body.code !== undefined) {
    return { ...body, type: "error", error: body }
  }
  return { ...body, error: isRecord(body.error) ? body.error : undefined }
}

const RETRYABLE = /rate.?limit|overload|server|unavailable|timeout/i

/**
 * Terminal handler for normalized frames whose error code is not listed in
 * ProviderError.parseStreamError: surface the provider message instead of
 * falling back to a raw JSON dump. Retryable only for rate-limit and
 * 5xx-style codes.
 */
export function fallback(body: Frame, responseBody: string) {
  const message = body.error?.message
  if (typeof message !== "string" || !message.trim()) return
  const code = body.error?.code
  const retryable =
    typeof code === "number"
      ? code === 429 || (code >= 500 && code < 600)
      : typeof code === "string" && RETRYABLE.test(code)
  return { type: "api_error" as const, message, isRetryable: retryable, responseBody }
}

const AUTH_ERROR =
  "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project."

export function hint(provider: ProviderV2.ID, error: APICallError) {
  if (provider !== ProviderV2.ID.make("google")) return
  if (error.statusCode !== 401) return
  if (error.message !== AUTH_ERROR) return

  return "Google Gemini rejected this API key. Check its type and status in Google AI Studio. Replace a Standard key with a new auth key; if it is already an auth key, check its Gemini API access or create a replacement. Restricted Standard keys work only until September 2026. See https://kilo.ai/docs/ai-providers/gemini."
}
