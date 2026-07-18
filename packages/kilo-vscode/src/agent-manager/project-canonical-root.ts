import { realpath } from "node:fs/promises"
import { resolve as resolvePath } from "node:path"
import { exec } from "../util/process"

export class NotAGitRepositoryError extends Error {
  override name = "NotAGitRepositoryError"
  constructor(public readonly input: string) {
    super(`Path is not inside a Git repository: ${input}`)
  }
}

export class CanonicalRootUnavailableError extends Error {
  override name = "CanonicalRootUnavailableError"
  constructor(
    public readonly input: string,
    public readonly cause: unknown,
  ) {
    super(`Could not resolve a canonical Git root for: ${input}`)
  }
}

/**
 * Resolve a path to its canonical Git top-level and resolve symlinks.
 *
 * - `input` may be relative or absolute. The current working directory is the
 *   base for relative input.
 * - If `input` (or any path inside it) is not inside a Git working tree, this
 *   throws `NotAGitRepositoryError`. Bare repositories and partial-checkout
 *   errors also surface as `NotAGitRepositoryError`.
 * - If `fs.realpath` fails on the resolved top level (path removed between
 *   the `git` and `realpath` calls, missing permissions, etc.), this throws
 *   `CanonicalRootUnavailableError` carrying the underlying cause.
 * - The returned path is the `realpath` of the Git top level — symlinks are
 *   resolved. Case is **not** normalized: callers on case-insensitive
 *   filesystems (macOS, Windows) that need a stable key should case-fold the
 *   result themselves before deriving an id, or rely on `projectIdFor` being
 *   fed a path that has already been canonicalized.
 */
export async function canonicalRoot(input: string): Promise<string> {
  const absolute = resolvePath(input)
  let top: string
  try {
    const { stdout } = await exec("git", ["-C", absolute, "rev-parse", "--show-toplevel"])
    top = stdout.trim()
  } catch (err) {
    const code = (err as { code?: unknown }).code
    if (code === "ENOENT") throw new CanonicalRootUnavailableError(input, err)
    throw new NotAGitRepositoryError(input)
  }
  if (!top) throw new NotAGitRepositoryError(input)
  try {
    return await realpath(top)
  } catch (err) {
    throw new CanonicalRootUnavailableError(input, err)
  }
}
