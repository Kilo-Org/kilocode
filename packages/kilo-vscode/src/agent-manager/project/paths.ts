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
  const revparse = async (arg: string) => (await run(["rev-parse", arg]))?.trimEnd()
  // Older Git echoes unsupported rev-parse flags into stdout with exit code zero.
  // --show-toplevel is already absolute; never resolve an option line as a path.
  const top = await revparse("--show-toplevel")
  if (!top || !path.isAbsolute(top)) return undefined
  const root = canonicalizePath(top)
  const [gitdir, common] = await Promise.all([revparse("--git-dir"), revparse("--git-common-dir")])
  if (!gitdir || !common || gitdir.startsWith("--") || common.startsWith("--")) return root
  // Git metadata paths can be relative to the command's cwd, not the extension host's cwd.
  if (samePath(canonicalizePath(path.resolve(dir, gitdir)), canonicalizePath(path.resolve(dir, common)))) {
    return root
  }
  const listing = await run(["worktree", "list", "--porcelain", "-z"])
  const plain = listing ?? (await run(["worktree", "list", "--porcelain"]))
  const fields = plain?.includes("\0") ? plain.split("\0") : plain?.split(/\r?\n/)
  const first = fields?.find((field) => field.startsWith("worktree "))
  const primary = first?.slice("worktree ".length)
  return primary && path.isAbsolute(primary) ? canonicalizePath(primary) : root
}
