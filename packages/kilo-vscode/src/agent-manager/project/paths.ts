/**
 * Project path canonicalization for the Agent Manager project registry.
 *
 * Project identity is anchored to the canonical Git top-level path so that
 * symlink aliases (e.g. /tmp -> /private/tmp) and case variants cannot
 * register the same repository twice or route sessions to the wrong project.
 */

import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { normalizePath } from "../git-import"

/** Resolve symlinks and normalize separators. Falls back to lexical resolution when the path does not exist. */
export function canonicalizePath(dir: string): string {
  const resolved = path.resolve(dir)
  try {
    return normalizePath(fs.realpathSync.native(resolved))
  } catch {
    return normalizePath(resolved)
  }
}

/** Compare two canonical paths. Case-insensitive filesystems compare folded. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "darwin" || platform === "win32") return a.toLowerCase() === b.toLowerCase()
  return a === b
}

/**
 * Resolve the branch for the tracked worktree whose canonical path matches `dir`.
 *
 * `git worktree list --porcelain` realpath-resolves worktree registration, so
 * tracked keys are canonical. The probe path is canonicalized the same way via
 * `canonicalizePath` and compared with `samePath`, so symlink aliases such as
 * /tmp -> /private/tmp and case variants on darwin/win32 cannot mark a real
 * worktree missing. Tracked keys that no longer exist fall back to lexical
 * normalization, preserving missing-path handling. Returns undefined when no
 * tracked entry matches.
 */
export function findTrackedBranch(
  tracked: Map<string, string>,
  dir: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const canonical = canonicalizePath(dir)
  for (const [key, branch] of tracked) {
    if (samePath(canonicalizePath(key), canonical, platform)) return branch
  }
  return undefined
}

/** Deterministic project id derived from the canonical root. Stable across restarts and panel recreations. */
export function projectIdFor(root: string): string {
  return `prj-${createHash("sha1").update(root).digest("hex").slice(0, 12)}`
}

/** Resolve linked worktrees to the primary checkout so project-local state is shared by the repository. */
export async function resolveProjectRoot(
  dir: string,
  git: (cwd: string, args: string[]) => Promise<string>,
): Promise<string | undefined> {
  const run = (args: string[]) =>
    Promise.resolve()
      .then(() => git(dir, args))
      .catch(() => undefined)
  const revparse = (args: string[]) => run(["rev-parse", ...args])
  const top = await revparse(["--path-format=absolute", "--show-toplevel"])
  if (!top) return undefined
  const root = canonicalizePath(top.trim())
  const [gitdir, common] = await Promise.all([
    revparse(["--path-format=absolute", "--git-dir"]),
    revparse(["--path-format=absolute", "--git-common-dir"]),
  ])
  if (!gitdir || !common) return root
  if (samePath(canonicalizePath(gitdir.trim()), canonicalizePath(common.trim()))) return root
  const listing = await run(["worktree", "list", "--porcelain", "-z"])
  const first = listing?.split("\0").find((field) => field.startsWith("worktree "))
  return first ? canonicalizePath(first.slice("worktree ".length)) : root
}
