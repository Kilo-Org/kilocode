import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Maximum number of parallel worktree versions for multi-version mode.
 * Keep in sync with MAX_MULTI_VERSIONS in webview-ui/src/types/messages.ts.
 */
export const MAX_MULTI_VERSIONS = 4

/** Kilo config directory name (project-level and inside worktrees). */
export const KILO_DIR = ".kilo"

/**
 * After renaming .kilocode → .kilo, fix git worktree internal references.
 *
 * Git stores absolute paths in .git/worktrees/{name}/gitdir. When the parent
 * directory is renamed, those paths become stale and git can't find the
 * worktrees. This rewrites any gitdir files that reference the old path.
 */
async function fixGitWorktreeRefs(root: string, log: (msg: string) => void): Promise<void> {
  const gitWorktreesDir = path.join(root, ".git", "worktrees")
  try {
    const stat = await fs.promises.stat(gitWorktreesDir)
    if (!stat.isDirectory()) return
  } catch {
    return
  }

  const oldSegment = path.join(root, ".kilocode") + path.sep
  const newSegment = path.join(root, KILO_DIR) + path.sep

  try {
    const entries = await fs.promises.readdir(gitWorktreesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const gitdirFile = path.join(gitWorktreesDir, entry.name, "gitdir")
      try {
        const content = await fs.promises.readFile(gitdirFile, "utf-8")
        if (content.includes(oldSegment)) {
          await fs.promises.writeFile(gitdirFile, content.replaceAll(oldSegment, newSegment))
          log(`Fixed git worktree ref: ${entry.name}`)
        }
      } catch {
        // gitdir file missing or unreadable — skip
      }
    }
  } catch {
    // .git/worktrees unreadable — skip
  }
}

/**
 * One-time migration: rename .kilocode/ to .kilo/ in a given parent directory.
 *
 * Skips when .kilocode doesn't exist, .kilo already exists, or the rename
 * fails (e.g. Windows file locking — will succeed on next startup).
 *
 * After a successful rename, also fixes git worktree internal references
 * in .git/worktrees/*/gitdir that point to the old .kilocode path.
 *
 * Must run before any code reads from KILO_DIR to avoid creating an empty
 * .kilo/ while the user's data still lives in .kilocode/.
 */
export async function migrateKiloDir(root: string, log: (msg: string) => void): Promise<void> {
  const legacy = path.join(root, ".kilocode")
  const target = path.join(root, KILO_DIR)

  try {
    const stat = await fs.promises.stat(legacy)
    if (!stat.isDirectory()) return
  } catch {
    return // .kilocode doesn't exist
  }

  try {
    await fs.promises.stat(target)
    return // .kilo already exists
  } catch {
    // .kilo doesn't exist — proceed with rename
  }

  try {
    await fs.promises.rename(legacy, target)
    log(`Migrated .kilocode to .kilo in ${root}`)
    await fixGitWorktreeRefs(root, log)
  } catch (err) {
    log(`Warning: failed to rename .kilocode to .kilo in ${root}: ${err}`)
  }
}
