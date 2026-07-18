/**
 * Worktree file/directory opening helpers (extracted from AgentManagerProvider
 * to keep it under the 2000-line cap).
 */

import * as fs from "fs"
import * as path from "path"
import { isAbsolutePath } from "../path-utils"
import type { WorktreeStateManager } from "./WorktreeStateManager"

export interface WorktreeFileDeps {
  getState: () => WorktreeStateManager | undefined
  getRoot: () => string | undefined
  openFolder: (path: string, newWindow: boolean) => void
  openFile: (path: string, line?: number, column?: number) => void
  showError: (msg: string) => void
  log: (msg: string) => void
}

/** Open a worktree directory directly in VS Code. */
export function openWorktreeDirectory(worktreeId: string, deps: WorktreeFileDeps): void {
  const state = deps.getState()
  if (!state) return
  const worktree = state.getWorktree(worktreeId)
  if (!worktree) return
  const target = path.normalize(worktree.path)
  if (!fs.existsSync(target)) {
    deps.log(`openWorktreeDirectory: missing path ${target}`)
    deps.showError("Worktree folder does not exist on disk.")
    return
  }
  deps.openFolder(target, true)
}

/** Open a file from a worktree or local session in the VS Code editor.
 *  Absolute paths are opened directly. Relative paths are resolved against the
 *  session's worktree directory (or repo root for local sessions) with
 *  symlink-traversal protection. */
export function openWorktreeFile(
  sessionId: string,
  filePath: string,
  line: number | undefined,
  column: number | undefined,
  deps: WorktreeFileDeps,
): void {
  if (isAbsolutePath(filePath)) {
    deps.openFile(filePath, line, column)
    return
  }
  const state = deps.getState()
  if (!state) return
  const session = state.getSession(sessionId)
  const base = session?.worktreeId ? state.getWorktree(session.worktreeId)?.path : deps.getRoot()
  if (!base) return
  let resolved: string
  try {
    const root = fs.realpathSync(base)
    resolved = fs.realpathSync(path.resolve(base, filePath))
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return
  } catch (err) {
    console.error("[Kilo New] AgentManagerProvider: Cannot resolve file path:", err)
    return
  }
  deps.openFile(resolved, line, column)
}
