export * as KiloErrors from "./errors.js"

import { Option, Schema } from "effect"

const JsonValue = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownOption(JsonValue)

export const CODES = {
  PAID_MODEL_AUTH_REQUIRED: "PAID_MODEL_AUTH_REQUIRED",
  PROMOTION_MODEL_LIMIT_REACHED: "PROMOTION_MODEL_LIMIT_REACHED",
  USAGE_LIMIT_EXCEEDED: "usage_limit_exceeded",
  INSUFFICIENT_CREDITS: "insufficient_credits",
  TOP_UP_IN_PROGRESS: "top_up_in_progress",
  MODEL_NOT_ALLOWED: "model_not_allowed",
  PROVIDER_NOT_ALLOWED: "provider_not_allowed",
  DATA_COLLECTION_REQUIRED: "data_collection_required",
  UPGRADE_REQUIRED: "upgrade_required",
  RATE_LIMIT_EXCEEDED: "rate_limit_exceeded",
  BYOK_KEY_REQUIRED: "byok_key_required",
  BYOK_ERROR: "byok_error",
} as const

export interface ParsedError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
}

// Parses both Kilo Gateway error envelopes (from `apps/web/src/app/api/openrouter/[...path]/route.ts` and
// `lib/ai-gateway/llm-proxy-helpers.ts`) plus mid-stream SSE error frames (from v1 `provider/error.ts`):
// 1. Nested `{ error: { code, message, title, balance, buyCreditsUrl }, error_type }`
// 2. Flat `{ error: "<string>", error_type: "<snake_case>", message?: "<string>" }`
// 3. Responses API terminal frame `{ type: "response.failed", response: { error: { code, message } } }`
// 4. Bare `{ code, message }`
export function parse(rawBody: string | unknown, status?: number): ParsedError | undefined {
  const value = typeof rawBody === "string" ? Option.getOrUndefined(decodeJson(rawBody)) : rawBody
  if (!isRecord(value)) return undefined

  // Unwrap `response.failed` terminal SSE frame (`/responses`).
  const unwrapped =
    value.type === "response.failed" && isRecord(value.response) && isRecord(value.response.error)
      ? { error: value.response.error, error_type: value.error_type }
      : value

  const nestedError = isRecord(unwrapped.error) ? unwrapped.error : undefined
  const rawCode =
    asString(nestedError?.code) ??
    asString(unwrapped.error_type) ??
    asString(unwrapped.code) ??
    asString(nestedError?.type)
  const rawMessage =
    asString(nestedError?.message) ??
    asString(unwrapped.message) ??
    (typeof unwrapped.error === "string" ? unwrapped.error : undefined)

  if (!rawCode && !rawMessage) return undefined

  const normalizedCode = rawCode ?? (status === 402 ? CODES.USAGE_LIMIT_EXCEEDED : "api_error")
  const message = formatMessage(normalizedCode, rawMessage, nestedError, unwrapped)
  if (!message) return undefined

  return {
    code: normalizedCode,
    message,
    retryable: isRetryable(normalizedCode, message, status),
  }
}

// Rewrites a non-2xx HTTP `Response` from the Kilo Gateway so that the upstream error classifier
// receives the formatted Kilo message and code while preserving status and headers. A non-retryable
// error also gets `x-should-retry: false`.
export async function rewriteHttpResponse(response: Response): Promise<Response> {
  if (response.status < 400) return response
  const text = await response.clone().text().catch(() => "")
  if (!text) return response
  const parsed = parse(text, response.status)
  if (!parsed) return response

  const headers = new Headers(response.headers)
  headers.set("content-type", "application/json")
  headers.delete("content-length")
  headers.delete("content-encoding")
  // kilo_port(gateway:1995b11b5cdd) As in v1 retry.ts, Kilo errors that need user action are not retried, also on a
  // 429 such as PROMOTION_MODEL_LIMIT_REACHED. The upstream retry policy reads this header. A body without a Kilo
  // code parses as `api_error`; it must keep the upstream retry decision for 408 and 409.
  if (!parsed.retryable && parsed.code !== "api_error") headers.set("x-should-retry", "false")
  const body = JSON.stringify({
    error: {
      code: parsed.code,
      type: parsed.code,
      message: parsed.message,
    },
    error_type: parsed.code,
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function formatMessage(
  code: string,
  rawMessage: string | undefined,
  nestedError: Record<string, unknown> | undefined,
  root: Record<string, unknown>,
): string | undefined {
  if (code === CODES.PAID_MODEL_AUTH_REQUIRED || code === "paid_model_auth_required") {
    return "You need to sign in to use this model. Sign in or create an account to access over 500 models, use credits at cost, or bring your own key."
  }
  if (code === CODES.PROMOTION_MODEL_LIMIT_REACHED || code === "promotion_limit_reached") {
    return "You need to sign up to keep going. Sign up for free to continue and explore 500 other models. Takes 2 minutes, no credit card required. Or come back later."
  }
  if (code === CODES.USAGE_LIMIT_EXCEEDED || code === CODES.INSUFFICIENT_CREDITS) {
    const title = asString(nestedError?.title) ?? asString(root.title)
    const buyUrl = asString(nestedError?.buyCreditsUrl) ?? asString(root.buyCreditsUrl)
    const balance = nestedError?.balance ?? root.balance
    const base = rawMessage ?? title ?? "Insufficient Kilo Gateway credits."
    const parts = [
      title && rawMessage && !rawMessage.startsWith(title) ? `${title}: ${rawMessage}` : base,
      typeof balance === "number" ? `(Balance: $${balance.toFixed(2)})` : undefined,
      buyUrl ? `Buy credits at ${buyUrl}` : undefined,
    ].filter(Boolean)
    return parts.join(" ")
  }
  return rawMessage
}

const RETRYABLE_CODE =
  /top_up_in_progress|rate.?limit|too.?many.?requests|rate increased too quickly|exhausted|overload|server|unavailable|timeout/i
const RETRYABLE_TEXT =
  /rate increased too quickly|rate.?limit|too.?many.?requests|try again (?:later|in\b)|(?:currently|temporarily) at capacity|temporarily unavailable/i

function isRetryable(code: string, message: string, status?: number): boolean {
  if (code === CODES.TOP_UP_IN_PROGRESS) return true
  if (
    code === CODES.PAID_MODEL_AUTH_REQUIRED ||
    code === "paid_model_auth_required" ||
    code === CODES.PROMOTION_MODEL_LIMIT_REACHED ||
    code === "promotion_limit_reached" ||
    code === CODES.USAGE_LIMIT_EXCEEDED ||
    code === CODES.INSUFFICIENT_CREDITS ||
    code === CODES.MODEL_NOT_ALLOWED ||
    code === CODES.PROVIDER_NOT_ALLOWED ||
    code === CODES.DATA_COLLECTION_REQUIRED ||
    code === CODES.UPGRADE_REQUIRED
  ) {
    return false
  }
  if (status === 429 || (status !== undefined && status >= 500 && status < 600)) return true
  if (RETRYABLE_CODE.test(code)) return true
  return RETRYABLE_TEXT.test(message)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
