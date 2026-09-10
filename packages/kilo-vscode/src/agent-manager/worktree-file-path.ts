import * as fs from "fs"
import * as path from "path"
import { isAbsolutePath } from "../path-utils"
import type { WorktreeStateManager } from "./WorktreeStateManager"

/**
 * Resolve a file reference from a worktree or local session to an absolute
 * path. Absolute inputs pass through; relative inputs resolve against the
 * context's worktree directory (repo root for local). Real paths are resolved
 * so a symlink cannot escape that directory, and out-of-bounds or unresolvable
 * paths return undefined. The id may be a worktree id, session id, or `local`.
 */
export function resolveWorktreeFile(
  state: WorktreeStateManager | undefined,
  id: string,
  file: string,
  root: string | undefined,
): string | undefined {
  if (isAbsolutePath(file)) return file
  if (!state) return
  const worktree = state.getWorktree(id)
  const session = worktree ? undefined : state.getSession(id)
  const base = worktree?.path ?? (session?.worktreeId ? state.getWorktree(session.worktreeId)?.path : root)
  if (!base) return
  try {
    const dir = fs.realpathSync(base)
    const resolved = fs.realpathSync(path.resolve(base, file))
    // Directory-boundary check: append path.sep so "/foo/bar" won't match "/foo/bar2/...".
    if (resolved !== dir && !resolved.startsWith(dir + path.sep)) return
    return resolved
  } catch (err) {
    console.error("[Kilo New] AgentManagerProvider: Cannot resolve file path:", err)
    return
  }
}
