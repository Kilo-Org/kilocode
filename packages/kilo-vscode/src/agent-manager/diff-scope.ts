/**
 * Composite diff-source keying for Agent Manager.
 *
 * Agent Manager keys diff sources by *context* (a worktree id, or the `local`
 * workspace pseudo-context) while the standalone Changes viewer keys by
 * *scope* (branch / staged / unstaged / session). To expose scopes in Agent
 * Manager we compose the two into a single id the SourceController can build.
 * The context is the sidebar selection, so it stays stable when the user
 * switches between session tabs of the same worktree; only the Session scope
 * follows the active session, carried inside the id.
 *
 *   ctx   = "local" | "<worktreeId>"
 *   scope = "branch" | "staged" | "unstaged" | "session"
 *   id    = `${ctx}#${scope}`        (git scopes)
 *   id    = `${ctx}#session:<sid>`   (session scope, sid = active session id)
 *
 * `ctx#branch` is the default and reproduces the pre-scope behavior exactly.
 */

export type DiffScope = "branch" | "staged" | "unstaged" | "session"

export const DEFAULT_DIFF_SCOPE: DiffScope = "branch"

const SEP = "#"
const SESSION_TOKEN = "session:"

export function composeDiffId(ctx: string, scope: DiffScope, sessionId?: string): string {
  if (scope === "session" && sessionId) return `${ctx}${SEP}${SESSION_TOKEN}${sessionId}`
  return `${ctx}${SEP}${scope}`
}

/**
 * Split a composite id back into context and scope. Tolerates a bare context
 * id (no separator) by assuming the default branch scope, which keeps the
 * pre-scope messages working unchanged.
 */
export function parseDiffId(id: string): { ctx: string; scope: DiffScope; sessionId?: string } {
  const idx = id.lastIndexOf(SEP)
  if (idx === -1) return { ctx: id, scope: DEFAULT_DIFF_SCOPE }
  const token = id.slice(idx + SEP.length)
  const ctx = id.slice(0, idx)
  if (token.startsWith(SESSION_TOKEN)) return { ctx, scope: "session", sessionId: token.slice(SESSION_TOKEN.length) }
  if (isDiffScope(token)) return { ctx, scope: token }
  return { ctx: id, scope: DEFAULT_DIFF_SCOPE }
}

export function isDiffScope(value: string): value is DiffScope {
  return value === "branch" || value === "staged" || value === "unstaged" || value === "session"
}

export function normalizeScope(value: unknown): DiffScope {
  return typeof value === "string" && isDiffScope(value) ? value : DEFAULT_DIFF_SCOPE
}

/**
 * Map a scope to the underlying standalone-viewer source id the catalog knows
 * how to build. `branch` maps to the workspace source; `session` needs the
 * active session id embedded in the source id (the context id is a worktree
 * or `local`, not a session).
 */
export function scopeToSourceId(scope: DiffScope, ctx: string, sessionId?: string): string {
  if (scope === "staged") return "staged"
  if (scope === "unstaged") return "unstaged"
  if (scope === "session") return `session:${sessionId ?? ctx}`
  return "workspace"
}
