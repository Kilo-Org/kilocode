// Presence context strings mirror the (private) cloud Event Service context
// scheme. The cloud package is private, so the literals are duplicated here and
// guarded by contract tests; a full drift guard lands later.

export const CONTEXT_PREFIX = "/presence/"
export const CLI_SESSION_PREFIX = "/presence/cli-session/"

export type Platform = "cli" | "vscode"

export function platformContext(platform: Platform): string {
  return `${CONTEXT_PREFIX}${platform}`
}

export function cliSessionContext(sessionId: string): string {
  return `${CLI_SESSION_PREFIX}${sessionId}`
}

// Event Service enforces a 256-char context limit.
export const MAX_CONTEXT_LENGTH = 256
// CLI_SESSION_PREFIX is 22 chars, so a session id must be <= 234 to keep the
// full context within the 256-char limit.
export const MAX_SESSION_ID_LENGTH = MAX_CONTEXT_LENGTH - CLI_SESSION_PREFIX.length

// Event Service socket limit is 200 contexts.
export const MAX_CONTEXTS = 200
// Reserve one slot for the platform context; visible session contexts cap at 199.
export const MAX_VISIBLE_SESSIONS = MAX_CONTEXTS - 1

// Per-viewer rejection thresholds: the service rejects oversized snapshots.
export const MAX_ATTACHED_PER_VIEWER = 1000
export const MAX_VISIBLE_PER_VIEWER = 199

// Viewer lease TTL: a viewer expires exactly 120s after its last update.
export const VIEWER_TTL_MS = 120_000
