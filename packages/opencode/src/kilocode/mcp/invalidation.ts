import type { McpAuth } from "../../mcp/auth"

// Automatic OAuth invalidation must never delete credentials that a concurrent
// operation already replaced. The SDK calls `invalidateCredentials` after a
// rejected refresh, but by then another Kilo instance may have saved a newer
// token for the same server (Atlassian rotates refresh tokens, and every
// directory instance shares one `mcp-auth.json`). Deleting blindly wipes the
// winner's tokens and forces a fresh sign-in everywhere.
//
// This helper decides, under the auth-file lock, whether the entry still holds
// the exact credential the failed request presented. When it does, the caller
// clears only the affected fields; when a newer credential won the race, the
// caller leaves it alone.

/** The credential a failed OAuth request was bound to. */
export interface Expected {
  /** Exact OAuth server URL the request belonged to. */
  serverUrl: string
  /** Refresh token the failed request submitted, when it submitted one. */
  refreshToken?: string
  /** Client identifier the failed request authenticated as. */
  clientId?: string
  /** Authorization server the credentials were discovered against. */
  issuer?: string
}

export type Outcome =
  /** The stored credential matched the expectation and the requested fields were cleared. */
  | { _tag: "cleared"; entry: McpAuth.Entry }
  /**
   * A different credential is stored now — either a newer one from a concurrent rotation, or an
   * entry bound to a different server URL. Nothing was deleted.
   */
  | { _tag: "superseded" }
  /** No entry exists for this server. */
  | { _tag: "missing" }

/**
 * True when the stored entry still holds the exact credential the failed
 * request presented. Ambiguous expectations (a field the caller did not pin)
 * are treated as a match so legacy single-process flows keep working, but a
 * mismatch on any pinned field means another operation won the race.
 */
export function matches(entry: McpAuth.Entry, expected: Expected, type: "tokens" | "client"): boolean {
  if (entry.serverUrl !== expected.serverUrl) return false

  if (type === "client") {
    if (expected.clientId != null && entry.clientInfo?.clientId !== expected.clientId) return false
    if (expected.issuer != null && entry.clientInfo?.issuer !== expected.issuer) return false
    return true
  }

  // "tokens": the client that presented the refresh must still own the entry.
  if (expected.clientId != null && entry.clientInfo?.clientId !== expected.clientId) return false
  if (expected.issuer != null && entry.tokens?.issuer !== expected.issuer) return false
  if (expected.refreshToken != null && entry.tokens?.refreshToken !== expected.refreshToken) return false
  return true
}

/**
 * Clear only the requested credential fields from a matched entry, preserving
 * every unrelated field (verifier, OAuth state, the other credential). Returns
 * the next entry, or `undefined` when the whole entry should be kept as-is.
 */
export function clear(entry: McpAuth.Entry, type: "tokens" | "client" | "all"): McpAuth.Entry {
  if (type === "all") return {}
  const next = { ...entry }
  if (type === "tokens") delete next.tokens
  else delete next.clientInfo
  return next
}
