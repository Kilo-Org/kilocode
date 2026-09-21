import { lstatSync, readdirSync } from "node:fs"
import path from "node:path"
import { isCredentialPath } from "./normalize"
import { canonical, inside } from "./resources"
import type { Resource, TrustedContext } from "./types"

/** Content searches may traverse children that are absent from the command line. */
export function searchScope(resources: Resource[], ctx: TrustedContext): string[] {
  const root = canonical(ctx.workspace_root, ctx.cwd)
  const pending = resources.map((r) => r.key)
  let count = 0
  while (pending.length) {
    const target = pending.pop()!
    if (++count > 10000) return ["search_scope_too_large"]
    if (isCredentialPath(target)) return ["search_may_read_credentials"]
    const info = lstatSync(target, { throwIfNoEntry: false })
    if (info?.isSymbolicLink()) {
      if (!inside(root, canonical(target, ctx.cwd))) return ["search_symlink_outside_workspace"]
      // Tool and platform differences in link-following semantics remain opaque.
      return ["search_symlink_requires_explicit_target"]
    }
    if (info?.isDirectory()) {
      for (const name of readdirSync(target)) {
        if (name === ".git") continue
        pending.push(path.join(target, name))
      }
    }
  }
  return []
}
