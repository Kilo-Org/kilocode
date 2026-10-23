/**
 * Attachment failures.
 *
 * Routed-attachment errors are not part of the generated SDK error union: the
 * server answers `{ error: "KILO_SESSION_ATTACHMENT", code, message }`. The
 * session-host control plane answers `{ code, message }`. Both shapes are
 * parsed here so callers can decide between re-attaching and surfacing a
 * failure. There is never a local fallback for a failed attachment.
 */
const CODES = [
  "unknown",
  "expired",
  "disposed",
  "unavailable",
  "too_large",
  "invalid_request",
  "auth_unavailable",
  "signed_out",
  "unauthorized",
  "payment_required",
  "not_found",
  "invalid_response",
  "rejected",
  "unknown_provider",
] as const

export type AttachmentCode = (typeof CODES)[number]

export interface AttachmentFailure {
  code: AttachmentCode
  message: string
  /** True when re-attaching can plausibly restore the session. */
  recoverable: boolean
}

const KNOWN = new Set<string>(CODES)

const RECOVERABLE = new Set<AttachmentCode>(["unknown", "expired", "disposed", "unavailable", "auth_unavailable"])

function object(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    return parse(value)
  }
  if (value && typeof value === "object") return value as Record<string, unknown>
  return
}

function parse(text: string): Record<string, unknown> | undefined {
  if (!text.startsWith("{")) return
  try {
    const value = JSON.parse(text) as unknown
    if (value && typeof value === "object") return value as Record<string, unknown>
  } catch {
    return
  }
  return
}

export function attachmentFailure(error: unknown): AttachmentFailure | undefined {
  const body = bodyOf(error)
  if (!body) return
  const code = typeof body.code === "string" ? body.code : undefined
  if (!code || !KNOWN.has(code)) return
  const message = typeof body.message === "string" ? body.message : code
  return { code: code as AttachmentCode, message, recoverable: RECOVERABLE.has(code as AttachmentCode) }
}

/**
 * The SDK wraps thrown bodies in an `Error` whose `cause.body` holds the parsed
 * response, so both the raw body and the wrapped form are understood.
 */
function bodyOf(error: unknown): Record<string, unknown> | undefined {
  const direct = object(error)
  if (direct && typeof direct.code === "string") return direct
  if (direct) {
    const cause = object(direct.cause)
    const body = cause ? object(cause.body) : undefined
    if (body) return body
    return direct
  }
  return
}

export function isRecoverable(error: unknown): boolean {
  return attachmentFailure(error)?.recoverable === true
}
