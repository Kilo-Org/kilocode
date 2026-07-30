/**
 * Composite diff-source keying for Agent Manager.
 *
 * Agent Manager keys diff sources by *context* (a session id, or the `local`
 * workspace pseudo-context) while the standalone Changes viewer keys by
 * *scope* (branch / staged / unstaged / session). To expose scopes in Agent
 * Manager we compose the two into a single id the SourceController can build.
 *
 *   ctx   = "local" | "<sessionId>"
 *   scope = "branch" | "staged" | "unstaged" | "session"
 *   id    = `${ctx}#${scope}`
 *
 * `ctx#branch` is the default and reproduces the pre-scope behavior exactly.
 */

export type DiffScope = "branch" | "staged" | "unstaged" | "session"

export const DEFAULT_DIFF_SCOPE: DiffScope = "branch"

const SEP = "#"

export function composeDiffId(ctx: string, scope: DiffScope): string {
  return `${ctx}${SEP}${scope}`
}

/**
 * Split a composite id back into context and scope. Tolerates a bare context
 * id (no separator) by assuming the default branch scope, which keeps the
 * pre-scope messages working unchanged.
 */
export function parseDiffId(id: string): { ctx: string; scope: DiffScope } {
  const idx = id.lastIndexOf(SEP)
  if (idx === -1) return { ctx: id, scope: DEFAULT_DIFF_SCOPE }
  const scope = id.slice(idx + SEP.length)
  if (isDiffScope(scope)) return { ctx: id.slice(0, idx), scope }
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
 * how to build. `branch` maps to the workspace source; `session` is handled
 * separately because it needs the session id embedded in the source id.
 */
export function scopeToSourceId(scope: DiffScope, ctx: string): string {
  if (scope === "staged") return "staged"
  if (scope === "unstaged") return "unstaged"
  if (scope === "session") return `session:${ctx}`
  return "workspace"
}
