// kilocode_change - new file
import * as fs from "fs/promises"
import * as path from "path"
import { Log } from "../util/log"

const log = Log.create({ service: "kilocode.migrate-kilo-dir" })

async function isDir(p: string): Promise<boolean> {
  return fs.stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  )
}

/**
 * After renaming .kilocode → .kilo, fix git worktree internal references.
 *
 * Git stores absolute paths in .git/worktrees/{name}/gitdir. When the parent
 * directory is renamed, those paths become stale and git can't find the
 * worktrees. This rewrites any gitdir files that reference the old path.
 */
async function fixGitWorktreeRefs(projectDir: string): Promise<void> {
  const gitWorktreesDir = path.join(projectDir, ".git", "worktrees")
  if (!(await isDir(gitWorktreesDir))) return

  const oldSegment = path.join(projectDir, ".kilocode") + path.sep
  const newSegment = path.join(projectDir, ".kilo") + path.sep

  try {
    const entries = await fs.readdir(gitWorktreesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const gitdirFile = path.join(gitWorktreesDir, entry.name, "gitdir")
      try {
        const content = await fs.readFile(gitdirFile, "utf-8")
        if (content.includes(oldSegment)) {
          await fs.writeFile(gitdirFile, content.replaceAll(oldSegment, newSegment))
          log.info("fixed git worktree ref", { worktree: entry.name })
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
 * Rename a .kilocode directory to .kilo if the legacy directory exists
 * and the new directory does not.
 *
 * Skips when:
 * - .kilocode doesn't exist (nothing to migrate)
 * - .kilo already exists (already migrated, or both present)
 * - .kilocode is not a directory
 *
 * After a successful rename, also fixes git worktree internal references
 * that point to the old .kilocode path.
 *
 * On failure (e.g. Windows file locking), logs a warning and returns false.
 * The caller should not add fallback paths — the rename will succeed on
 * the next startup once file locks are released.
 */
async function renameIfNeeded(dir: string): Promise<boolean> {
  const legacy = path.join(dir, ".kilocode")
  const target = path.join(dir, ".kilo")

  if (!(await isDir(legacy))) return false
  if (await isDir(target)) {
    log.info("both .kilocode and .kilo exist, skipping migration", { dir })
    return false
  }

  try {
    await fs.rename(legacy, target)
    log.info("migrated .kilocode to .kilo", { dir })
    await fixGitWorktreeRefs(dir)
    return true
  } catch (err) {
    // On Windows, rename can fail with EPERM/EBUSY if files inside the
    // directory are held open by another process (e.g. the VS Code extension).
    // The migration will succeed on the next startup.
    log.warn("failed to rename .kilocode to .kilo — will retry on next startup", { dir, error: err })
    return false
  }
}

/**
 * One-time migration: rename project-level .kilocode/ to .kilo/.
 *
 * Only migrates the project directory — the global ~/.kilocode/ is left
 * untouched because legacy CLI instances and migration scripts still
 * read from it.
 *
 * Safe to call multiple times and from multiple processes — skips when
 * .kilo already exists or .kilocode is absent.
 */
export async function migrateKiloDir(projectDir: string): Promise<void> {
  await renameIfNeeded(projectDir)
}
