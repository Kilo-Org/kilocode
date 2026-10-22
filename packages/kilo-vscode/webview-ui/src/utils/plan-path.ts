/**
 * Compute the display path for a plan file link.
 *
 * - Relative paths are returned as-is.
 * - Absolute paths inside `root` are returned as a repo-relative path.
 * - Absolute paths outside `root` are returned as-is (absolute).
 *
 * `root` is the workspace/worktree directory string from the server context.
 * Both Unix and Windows separators are normalised before comparison.
 */
export function planDisplayPath(plan: string, root: string): string {
  if (!plan) return plan

  // Already relative — nothing to do.
  if (!isAbsolutePlan(plan)) return plan

  const normalRoot = normaliseDir(root)
  const normalPlan = normalisePath(plan)

  if (!normalRoot || !normalPlan.startsWith(normalRoot)) return plan

  // Strip the root prefix (and a trailing separator if present).
  const rel = plan.slice(normalRoot.length).replace(/^[\\/]/, "")
  return rel || plan
}

function normalisePath(p: string): string {
  return p.replace(/\\/g, "/")
}

function normaliseDir(dir: string): string {
  if (!dir) return ""
  const n = dir.replace(/\\/g, "/")
  return n.endsWith("/") ? n : n + "/"
}

function isAbsolutePlan(p: string): boolean {
  // Unix absolute
  if (p.startsWith("/")) return true
  // Windows absolute: C:\ or C:/
  if (/^[A-Za-z]:[\\/]/.test(p)) return true
  return false
}
