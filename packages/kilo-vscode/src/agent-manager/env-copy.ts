/**
 * Copies .env files from the main repository into a worktree.
 *
 * Runs automatically before the user setup script so worktrees inherit
 * environment configuration without manual copying.  Only plain files
 * named exactly `.env` or matching `.env.<qualifier>` (e.g. `.env.local`,
 * `.env.development`) at the repo root are considered.  Files like `.envrc`
 * or `.environment` are excluded — they follow different conventions.
 * Nested directories are not traversed and existing files in the worktree
 * are never overwritten.
 */

import * as fs from "node:fs"
import { constants } from "node:fs"
import * as path from "node:path"

/** Result returned after a copy attempt. */
export interface EnvCopyResult {
  /** Files that were copied. */
  copied: string[]
  /** Files that were skipped because they already exist in the worktree. */
  skipped: string[]
}

type Log = (msg: string) => void

/** Match `.env` exactly, or `.env.` followed by a qualifier. */
function isEnvFile(name: string): boolean {
  return name === ".env" || name.startsWith(".env.")
}

/**
 * List `.env` / `.env.*` filenames at the root of `dir`.
 * Returns basenames only (e.g. `[".env", ".env.local"]`).
 */
export function listEnvFiles(dir: string): string[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile() && isEnvFile(e.name)).map((e) => e.name)
  } catch {
    return []
  }
}

/**
 * Copy `.env` / `.env.*` files from `repoPath` into `worktreePath`.
 *
 * - Only root-level files named `.env` or `.env.<qualifier>` are copied.
 * - Files that already exist in the worktree are skipped (no overwrite).
 * - Cross-platform: uses only Node `fs` APIs.
 */
export async function copyEnvFiles(
  repoPath: string,
  worktreePath: string,
  log: Log = () => {},
): Promise<EnvCopyResult> {
  const names = listEnvFiles(repoPath)
  if (names.length === 0) {
    log("No .env files found in main repo")
    return { copied: [], skipped: [] }
  }

  const result: EnvCopyResult = { copied: [], skipped: [] }

  for (const name of names) {
    const src = path.join(repoPath, name)
    const dst = path.join(worktreePath, name)

    try {
      // COPYFILE_EXCL fails atomically if dst exists — no TOCTOU race.
      await fs.promises.copyFile(src, dst, constants.COPYFILE_EXCL)
      log(`Copied ${name}`)
      result.copied.push(name)
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && err.code === "EEXIST") {
        log(`Skipping ${name} (already exists in worktree)`)
        result.skipped.push(name)
        continue
      }
      log(`Failed to copy ${name}: ${err}`)
    }
  }

  return result
}
