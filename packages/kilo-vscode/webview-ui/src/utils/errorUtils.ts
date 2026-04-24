import type { AssistantMessage } from "@kilocode/sdk/v2"

export function unwrapError(message: string): string {
  const text = message.replace(/^Error:\s*/, "").trim()
  const tryParse = (v: string) => {
    try {
      return JSON.parse(v) as unknown
    } catch {
      return undefined
    }
  }
  const read = (v: string) => {
    const first = tryParse(v)
    if (typeof first !== "string") return first
    return tryParse(first.trim())
  }
  let json = read(text)
  if (json === undefined) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start !== -1 && end > start) json = read(text.slice(start, end + 1))
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return message
  const rec = json as Record<string, unknown>
  const err =
    rec.error && typeof rec.error === "object" && !Array.isArray(rec.error)
      ? (rec.error as Record<string, unknown>)
      : undefined
  if (err) {
    const type = typeof err.type === "string" ? err.type : undefined
    const msg = typeof err.message === "string" ? err.message : undefined
    if (type && msg) return `${type}: ${msg}`
    if (msg) return msg
    if (type) return type
    const code = typeof err.code === "string" ? err.code : undefined
    if (code) return code
  }
  const msg = typeof rec.message === "string" ? rec.message : undefined
  if (msg) return msg
  const reason = typeof rec.error === "string" ? rec.error : undefined
  if (reason) return reason
  return message
}

const errorCodes = {
  PAID_MODEL_AUTH_REQUIRED: "PAID_MODEL_AUTH_REQUIRED",
  PROMOTION_MODEL_LIMIT_REACHED: "PROMOTION_MODEL_LIMIT_REACHED",
} as const

export interface ParsedError {
  statusCode?: number
  code?: string
  message?: string
}

export function parseAssistantError(error: AssistantMessage["error"] | null | undefined): ParsedError | null {
  if (!error) return null
  if (error.name !== "APIError") return null

  const data = error.data
  if (!data) return null

  const statusCode = typeof data.statusCode === "number" ? data.statusCode : undefined
  const message = typeof data.message === "string" ? data.message : undefined

  let code: string | undefined
  if (typeof data.responseBody === "string") {
    try {
      const body = JSON.parse(data.responseBody) as Record<string, unknown>
      const bodyError = body.error as Record<string, unknown> | undefined
      if (bodyError && typeof bodyError.code === "string") {
        code = bodyError.code
      } else if (typeof body.code === "string") {
        code = body.code
      }
    } catch {
      // responseBody is not valid JSON — ignore
    }
  }

  return { statusCode, code, message }
}

export function isUnauthorizedPaidModelError(parsed: ParsedError | null): boolean {
  if (!parsed) return false
  return parsed.statusCode === 401 && parsed.code === errorCodes.PAID_MODEL_AUTH_REQUIRED
}

/**
 * Accepts both 401 (current backend) and 429 (future backend) to support
 * the transition. Keep 401 until the backend is updated to return 429.
 */
export function isUnauthorizedPromotionLimitError(parsed: ParsedError | null): boolean {
  if (!parsed) return false
  return (
    (parsed.statusCode === 401 || parsed.statusCode === 429) && parsed.code === errorCodes.PROMOTION_MODEL_LIMIT_REACHED
  )
}
