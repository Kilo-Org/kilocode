// kilocode_change - new file
import fs from "fs/promises"
import path from "path"

/**
 * Filesystem identity for the deterministic security layer.
 *
 * Path classification in `adapter.ts` is textual and stays that way: the pure core must never touch
 * the filesystem. A symlink inside the workspace would otherwise be judged by its own name, so
 * `repo/notes.md -> .git/hooks/pre-commit` would classify as an ordinary file and pass. The real
 * target is resolved *once*, here, before the ask reaches `Permission.ask`, and travels alongside
 * the pattern as plain strings the adapter can classify.
 *
 * Resolution never fails open. A target that cannot be determined is reported as an empty string,
 * which the adapter reads as an unknown target and the core holds at ask.
 *
 * This is identity, not TOCTOU hardening: the filesystem can still change between the resolution
 * and the write. Closing that needs kernel-level enforcement and is deliberately out of scope.
 */
export namespace SecurityRealpath {
  /** Permissions whose patterns are concrete file paths rather than globs or commands. */
  const RESOLVABLE = new Set(["edit", "write", "read", "notebook_edit", "notebook_read"])

  /** Reported for a target that could not be determined. The adapter classifies it as unknown. */
  export const UNRESOLVED = ""

  /** Depth guard for the ancestor walk and for symlink chains. */
  const MAX_DEPTH = 64
  const MAX_LINKS = 16

  function glob(pattern: string) {
    return /[*?[\]]/.test(pattern)
  }

  async function link(target: string) {
    let current = target
    for (let i = 0; i < MAX_LINKS; i++) {
      let stat
      try {
        stat = await fs.lstat(current)
      } catch {
        return current
      }
      if (!stat.isSymbolicLink()) return current
      try {
        current = path.resolve(path.dirname(current), await fs.readlink(current))
      } catch {
        return current
      }
    }
    return current
  }

  /**
   * The real path a write or read would land on.
   *
   * An existing target resolves through `realpath`. A target that does not exist yet — a new file,
   * or a whole new directory tree — resolves its deepest existing ancestor and rejoins the missing
   * tail, so creating a file is never mistaken for an unresolvable one. A symlink whose target does
   * not exist yet is followed by hand, because that is the ordinary case for a hook that has not
   * been written before.
   */
  export async function of(target: string, worktree: string): Promise<string | undefined> {
    if (!target || /^~[^/\\]*[/\\]/.test(target) || target === "~") return undefined
    const absolute = path.normalize(path.isAbsolute(target) ? target : path.join(worktree, target))

    const missing: string[] = []
    let current = absolute
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      try {
        const real = await fs.realpath(current)
        let out = real
        for (const segment of missing) {
          out = await link(path.join(out, segment))
        }
        return out
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        // Anything but "it is not there yet" leaves the target genuinely undetermined.
        if (code !== "ENOENT" && code !== "ENOTDIR") return undefined
        const parent = path.dirname(current)
        if (parent === current) return undefined
        missing.unshift(path.basename(current))
        current = parent
      }
    }
    return undefined
  }

  export async function all(targets: readonly string[], worktree: string): Promise<Array<string | undefined>> {
    return Promise.all(targets.map((target) => of(target, worktree)))
  }

  /**
   * Resolved targets for one permission request, or `undefined` when the request carries nothing
   * resolvable. The array is dense and index-aligned with `patterns`, so it survives a JSON round
   * trip to clients without a hole turning into a failure.
   */
  export async function paths(
    request: { permission: string; patterns: readonly string[] },
    worktree: string,
  ): Promise<string[] | undefined> {
    if (!RESOLVABLE.has(request.permission)) return undefined
    if (request.patterns.length === 0) return undefined
    if (request.patterns.some(glob)) return undefined
    const resolved = await all(request.patterns, worktree)
    return resolved.map((item) => item ?? UNRESOLVED)
  }

  /** Resolve the shell scan's file effects in place, so a redirect through a symlink is judged too. */
  export async function effects(list: unknown, worktree: string): Promise<unknown> {
    if (!Array.isArray(list)) return list
    return Promise.all(
      list.map(async (item) => {
        if (!item || typeof item !== "object") return item
        const value = item as { operation?: unknown; path?: unknown }
        if (typeof value.path !== "string" || value.path.length === 0) return item
        const real = await of(value.path, worktree)
        return real ? { ...value, path: real } : { operation: value.operation }
      }),
    )
  }
}
