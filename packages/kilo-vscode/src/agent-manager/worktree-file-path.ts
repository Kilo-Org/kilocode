import * as fs from "fs"
import * as path from "path"
import { isAbsolutePath } from "../path-utils"
import type { WorktreeStateManager } from "./WorktreeStateManager"

/**
 * The directory a worktree id, session id, or `local` reads files from.
 *
 * A session runs in exactly one directory on the server, `directory`. When it is known it wins: the state file never
 * files a subagent, and a filing can lag behind the server after a move the host missed or one an older build left
 * behind. Without it, a filed session falls back to its filing.
 */
export function resolveWorktreeRoot(
  state: WorktreeStateManager | undefined,
  id: string,
  root: string | undefined,
  directory?: string,
): string | undefined {
  if (id === "local") return root
  const worktree = state?.getWorktree(id)
  if (worktree) return worktree.path
  if (directory) return directory
  const session = state?.getSession(id)
  if (!session) return undefined
  // A known session without a worktree is a local session, which reads from the project root.
  return session.worktreeId ? state?.getWorktree(session.worktreeId)?.path : root
}

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
  directory?: string,
): string | undefined {
  if (isAbsolutePath(file)) return file
  const base = resolveWorktreeRoot(state, id, root, directory)
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

/** The directory a session works in: its worktree, or the project root for a local session. */
export function sessionDirectory(
  state: WorktreeStateManager | undefined,
  id: string | null,
  root: string | undefined,
): string | undefined {
  if (!id) return root
  const session = state?.getSession(id)
  const worktree = session?.worktreeId ? state?.getWorktree(session.worktreeId) : undefined
  return worktree?.path ?? root
}
