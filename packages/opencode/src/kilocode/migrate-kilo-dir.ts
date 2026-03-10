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
 * Rename a .kilocode directory to .kilo if the legacy directory exists
 * and the new directory does not.
 *
 * Skips when:
 * - .kilocode doesn't exist (nothing to migrate)
 * - .kilo already exists (already migrated, or both present)
 * - .kilocode is not a directory
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
