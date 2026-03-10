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
 * One-time migration: rename .kilocode/ to .kilo/ in a given parent directory.
 *
 * Skips when .kilocode doesn't exist, .kilo already exists, or the rename
 * fails (e.g. Windows file locking — will succeed on next startup).
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
  } catch (err) {
    log(`Warning: failed to rename .kilocode to .kilo in ${root}: ${err}`)
  }
}
