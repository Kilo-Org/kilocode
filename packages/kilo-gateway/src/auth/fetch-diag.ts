/**
 * Diagnostic helpers for device authorization fetches.
 *
 * The cloud auth routes don't currently map internal errors (rate limit, DB
 * failure, missing forwarded-for header) to distinct status codes — almost
 * everything surfaces as a bare 500. These helpers enrich the client-side
 * error so users (and bug reports) have something actionable instead of just
 * "Failed to initiate device authorization: 500".
 */

const BODY_SNIPPET_MAX = 300

/**
 * Read a small prefix of the response body without throwing. Returns an empty
 * string if the body can't be read (already consumed, stream error, etc).
 */
async function snippet(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  if (!text) return ""
  const trimmed = text.trim()
  if (trimmed.length <= BODY_SNIPPET_MAX) return trimmed
  return trimmed.slice(0, BODY_SNIPPET_MAX) + "…"
}

/**
 * Best-effort extraction of a server-provided error message. Falls back to the
 * raw snippet if the body isn't JSON or doesn't carry an `error`/`message`
 * field.
 */
function extract(body: string): string {
  if (!body) return ""
  if (body.startsWith("{") || body.startsWith("[")) {
    const parsed = JSON.parse(body) as unknown
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>
      if (typeof obj.error === "string") return obj.error
      if (typeof obj.message === "string") return obj.message
    }
  }
  return body
}

/** Hint for common status codes seen from the Kilo auth backend. */
function hint(status: number): string {
  if (status === 429) return "Too many pending authorization requests. Wait a few minutes and retry."
  if (status === 500)
    return "Server error. This is usually a transient backend issue, a rate limit (≥5 pending codes from your IP), or a missing proxy header. Retry in a minute; if it persists, report it with the request id above."
  if (status === 502 || status === 503 || status === 504)
    return "Auth backend is unavailable. A deploy may be in progress — retry shortly."
  if (status >= 500) return "Unexpected server error. Retry shortly."
  if (status === 401 || status === 403) return "Authentication rejected by the server."
  if (status >= 400) return "Request rejected by the server."
  return ""
}

/**
 * Build a detailed error for a failed HTTP response. Pulls the request id and
 * a body snippet if available, then appends a status-specific hint.
 */
export async function httpError(prefix: string, url: string, res: Response): Promise<Error> {
  const body = await snippet(res)
  const msg = extract(body)
  const rid = res.headers.get("x-request-id") || res.headers.get("x-vercel-id") || ""
  const parts = [`${prefix}: ${res.status} ${res.statusText || ""}`.trim(), `url=${url}`]
  if (rid) parts.push(`request-id=${rid}`)
  if (msg) parts.push(`server: ${msg}`)
  const tip = hint(res.status)
  if (tip) parts.push(tip)
  return new Error(parts.join(" · "))
}

/**
 * Wrap a `fetch` network-level failure (DNS, TLS, offline, refused, timeout)
 * with a diagnostic message. Returns the original error untouched if it isn't
 * a recognizable network failure so that upstream logging keeps the stack.
 */
export function networkError(prefix: string, url: string, err: unknown): Error {
  const cause = err instanceof Error ? err : new Error(String(err))
  const detail = cause.message || cause.name || "unknown error"
  const e = new Error(
    `${prefix}: network error reaching ${url} (${detail}). ` +
      "Check your internet connection, VPN/proxy, and that KILO_API_URL points at a reachable host.",
  )
  // Preserve the original for log pipelines that read `.cause`.
  ;(e as Error & { cause?: unknown }).cause = cause
  return e
}
