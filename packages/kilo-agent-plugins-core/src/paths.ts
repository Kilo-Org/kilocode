export * as Paths from "./paths"

import { lstat, realpath, stat } from "node:fs/promises"
import path from "node:path"

/** True when `candidate` is `root` or below it. Both must already be resolved; segments are compared, not prefixes. */
export function contains(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** The filesystem kind behind a path after following links, or `missing` when nothing is there. */
export async function kind(target: string) {
  const link = await lstat(target).catch(() => undefined)
  if (!link) return "missing" as const
  const info = await stat(target).catch(() => undefined)
  if (!info) return "broken" as const
  if (info.isDirectory()) return "directory" as const
  if (info.isFile()) return "file" as const
  return "other" as const
}

/**
 * Resolves a path that may not exist yet: the deepest existing ancestor is resolved through the filesystem and the
 * missing remainder is appended. Containment checks on the result see through symlinks in the existing part.
 */
export async function resolve(target: string): Promise<string> {
  const absolute = path.resolve(target)
  const resolved = await realpath(absolute).catch(() => undefined)
  if (resolved) return resolved
  const parent = path.dirname(absolute)
  if (parent === absolute) return absolute
  return path.join(await resolve(parent), path.basename(absolute))
}

/** Resolves `target` and returns it only when it stays inside the already resolved `root`. */
export async function inside(root: string, target: string) {
  const resolved = await resolve(target)
  return contains(root, resolved) ? resolved : undefined
}
