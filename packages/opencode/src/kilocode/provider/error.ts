import type { APICallError } from "ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { isRecord } from "@/util/record"
import { z } from "zod"

export type Frame = {
  type?: unknown
  error?: Record<string, unknown>
} & Record<string, unknown>

const payload = z.looseObject({
  code: z.union([z.string(), z.number()]).nullish(),
  message: z.string().nullish(),
})

// OpenAI Responses API terminal frame forwarded by @ai-sdk/openai >= 3.0.82
const terminal = z.looseObject({
  type: z.literal("response.failed"),
  response: z.looseObject({ error: payload }),
})

// Envelope-less chat-completions wrapper; checked before `bare` so a
// nested `error` record wins over bare top-level fields and gateway
// wrappers keep the specific inner code
const wrapper = z.looseObject({
  type: z.undefined().optional(),
  error: payload,
})

// Bare error object
const bare = z.looseObject({
  type: z.undefined().optional(),
  code: z.union([z.string(), z.number(), z.null()]),
  message: z.string(),
})

/**
 * Normalize provider stream error frames that arrive without the
 * `{ type: "error" }` envelope expected by ProviderError.parseStreamError.
 */
export function frame(body: unknown): Frame {
  const failed = terminal.safeParse(body)
  if (failed.success) return { type: "error", error: failed.data.response.error }
  const wrapped = wrapper.safeParse(body)
  if (wrapped.success) return { ...wrapped.data, type: "error" }
  const direct = bare.safeParse(body)
  if (direct.success) return { ...direct.data, type: "error", error: direct.data }
  if (!isRecord(body)) return {}
  return { ...body, error: isRecord(body.error) ? body.error : undefined }
}

const RETRYABLE = /rate.?limit|too.?many.?requests|rate increased too quickly|exhausted|overload|server|unavailable|timeout/i
// Keep free-form message matching narrow: Session.retryable only applied
// rate-limit phrases to prose; the wider pattern above is for structured
// code/type fields only
const RETRYABLE_TEXT = /rate increased too quickly|rate.?limit|too.?many.?requests/i

// Must stay at least as permissive as the Session.retryable heuristics that
// applied when these frames still surfaced as NamedError.Unknown, or
// previously-retried provider errors silently become terminal
function retryable(error: Frame["error"], message: string) {
  const code = error?.code
  const numeric = typeof code === "number" ? code : typeof code === "string" && code.trim() !== "" ? Number(code) : NaN
  if (!Number.isNaN(numeric)) {
    if (numeric === 429 || (numeric >= 500 && numeric < 600)) return true
  } else if (typeof code === "string" && RETRYABLE.test(code)) {
    return true
  }
  const type = error?.type
  if (typeof type === "string" && RETRYABLE.test(type)) return true
  return RETRYABLE_TEXT.test(message)
}

/**
 * Terminal handler for normalized frames whose error code is not listed in
 * ProviderError.parseStreamError: surface the provider message instead of
 * falling back to a raw JSON dump. Retryable only for rate-limit and
 * 5xx-style signals in the code, type, or message.
 */
export function fallback(body: Frame, responseBody: string) {
  const message = body.error?.message
  if (typeof message !== "string" || !message.trim()) return
  return { type: "api_error" as const, message, isRetryable: retryable(body.error, message), responseBody }
}

const AUTH_ERROR =
  "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project."

export function hint(provider: ProviderV2.ID, error: APICallError) {
  if (provider !== ProviderV2.ID.make("google")) return
  if (error.statusCode !== 401) return
  if (error.message !== AUTH_ERROR) return

  return "Google Gemini rejected this API key. Check its type and status in Google AI Studio. Replace a Standard key with a new auth key; if it is already an auth key, check its Gemini API access or create a replacement. Restricted Standard keys work only until September 2026. See https://kilo.ai/docs/ai-providers/gemini."
}
