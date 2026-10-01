import type { McpStatus } from "@kilocode/sdk/v2/client"

/**
 * Substrings that indicate a `failed` MCP status is actually a recoverable
 * sign-in failure. The CLI only emits `needs_auth` on a thrown
 * `UnauthorizedError`; most real-world OAuth failures (expired tokens,
 * rejected consent, HTTP 401/403 before the OAuth handshake starts) arrive
 * as plain `failed` instead. Matched against the lowercased error text.
 */
const AUTH_FAILURE_MARKERS = [
  "unauthorized",
  "authentication required",
  "needs authentication",
  "not authenticated",
  "browser authorization",
  "token exchange failed",
  "invalid_token",
  "invalid_grant",
]

/**
 * Word-boundary markers. Anchored so substrings like "myoauthapp.internal"
 * or "oauthserver" don't match.
 */
const AUTH_FAILURE_WORD_MARKERS = [/\boauth\b/]

/**
 * HTTP 401/403 anchored to an "http" or "status" prefix so a port number
 * (":40123") or a duration ("403 ms") doesn't match.
 */
const AUTH_FAILURE_HTTP_STATUS = /\b(?:http|status)\D{0,10}40[13]\b/

/** True when an MCP `failed` error message is recoverable by signing in again. */
export function authFailure(error: string | undefined): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  if (AUTH_FAILURE_MARKERS.some((marker) => lower.includes(marker))) return true
  if (AUTH_FAILURE_WORD_MARKERS.some((pattern) => pattern.test(lower))) return true
  return AUTH_FAILURE_HTTP_STATUS.test(lower)
}

/**
 * Rewrite recoverable `failed` entries to `needs_auth`, preserving `error`
 * so the Settings UI can still show the original reason as a tooltip.
 * Settings, the prompt-area issue indicator, and the Marketplace
 * post-install prompt all read status through this function so they agree
 * on which servers need sign-in.
 */
export function normalize(status: Record<string, McpStatus>): Record<string, McpStatus> {
  const result: Record<string, McpStatus> = {}
  for (const [name, entry] of Object.entries(status)) {
    if (entry.status === "failed" && authFailure(entry.error)) {
      result[name] = { status: "needs_auth" }
      continue
    }
    result[name] = entry
  }
  return result
}

/** Names of servers reporting `needs_auth` after normalization, sorted. */
export function needsAuthNames(status: Record<string, McpStatus>): string[] {
  return Object.entries(normalize(status))
    .filter(([, entry]) => entry.status === "needs_auth")
    .map(([name]) => name)
    .sort()
}
