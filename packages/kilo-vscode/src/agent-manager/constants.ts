import * as fs from "node:fs"
import * as path from "node:path"

// TODO: Remove the legacy .kilocode -> .kilo migration helpers below after the
// GA release cleanup tracked in https://github.com/Kilo-Org/kilocode/issues/6986.

/**
 * Maximum number of parallel worktree versions for multi-version mode.
 * Keep in sync with MAX_MULTI_VERSIONS in webview-ui/src/types/messages.ts.
 */
export const MAX_MULTI_VERSIONS = 4

/** Telemetry source identifier for all Agent Manager events. */
export const PLATFORM = "agent-manager" as const

/** Kilo config directory name (project-level and inside worktrees). */
export const KILO_DIR = ".kilo"

/** Legacy config directory name for backward compatibility reads. */
export const LEGACY_DIR = ".kilocode"

/** Agent Manager files that should be migrated from .kilocode/ to .kilo/. */
const AGENT_MANAGER_ITEMS = [
  "agent-manager.json",
  "worktrees",
  "setup-script",
  "setup-script.sh",
  "setup-script.ps1",
  "setup-script.cmd",
  "setup-script.bat",
]

/**
 * Migrate Agent Manager data from .kilocode/ to .kilo/.
 *
 * Moves individual Agent Manager files/directories (worktrees, state,
 * setup scripts) from the legacy .kilocode/ into .kilo/. Skips items
 * that already exist in .kilo/ (the new location wins). This is safe
 * because Agent Manager exclusively owns these files.
 *
 * Fixes git worktree internal references (.git/worktrees/{name}/gitdir)
 * whenever .kilo/worktrees/ exists so partially migrated repos recover too.
 *
 * Idempotent: safe to call on every startup.
 */
export async function migrateAgentManagerData(root: string, log: (msg: string) => void): Promise<void> {
  const legacy = path.join(root, LEGACY_DIR)
  const target = path.join(root, KILO_DIR)

  if (await isDirectory(legacy)) {
    // Ensure .kilo/ exists
    try {
      await fs.promises.mkdir(target, { recursive: true })
    } catch {
      // already exists
    }

    for (const item of AGENT_MANAGER_ITEMS) {
      const src = path.join(legacy, item)
      const dst = path.join(target, item)

      if (!(await exists(src))) continue

      if (await exists(dst)) {
        log(`Skipping ${item}: already exists in ${KILO_DIR}`)
        continue
      }

      try {
        await fs.promises.rename(src, dst)
        log(`Migrated ${item} from ${LEGACY_DIR} to ${KILO_DIR}`)
      } catch (err) {
        // On Windows, rename can fail with EPERM/EBUSY if files are held open.
        // Will succeed on next startup.
        log(`Warning: failed to migrate ${item}: ${err}`)
      }
    }
  }

  if (await isDirectory(path.join(target, "worktrees"))) {
    await fixGitWorktreeRefs(root, log)
  }
}

async function exists(filepath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filepath)
    return true
  } catch {
    return false
  }
}

async function isDirectory(filepath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filepath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * Resolve the real git directory for a repository root.
 * When root/.git is a directory, returns it directly.
 * When root/.git is a file (worktree), follows the gitdir pointer
 * up two levels to reach the shared git directory.
 */
async function resolveGitDir(root: string): Promise<string | undefined> {
  const gitPath = path.join(root, ".git")
  try {
    const stat = await fs.promises.stat(gitPath)
    if (stat.isDirectory()) return gitPath

    const content = await fs.promises.readFile(gitPath, "utf-8")
    const match = content.match(/^gitdir:\s*(.+)$/m)
    if (!match) return undefined
    // gitdir points to e.g. /repo/.git/worktrees/foo — go up two levels to /repo/.git
    return path.resolve(path.dirname(gitPath), match[1].trim(), "..", "..")
  } catch {
    return undefined
  }
}

/**
 * After moving worktrees from .kilocode/ to .kilo/, fix git internal refs.
 *
 * Git stores absolute paths in .git/worktrees/{name}/gitdir. When the
 * worktree directory moves, those paths become stale. This rewrites any
 * gitdir files that reference the old .kilocode path.
 */
async function fixGitWorktreeRefs(root: string, log: (msg: string) => void): Promise<void> {
  const gitDir = await resolveGitDir(root)
  if (!gitDir) return

  const gitWorktreesDir = path.join(gitDir, "worktrees")
  try {
    const stat = await fs.promises.stat(gitWorktreesDir)
    if (!stat.isDirectory()) return
  } catch {
    return
  }

  const oldSegment = path.join(root, LEGACY_DIR) + path.sep
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
