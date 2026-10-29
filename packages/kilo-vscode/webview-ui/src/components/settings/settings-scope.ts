/**
 * The legacy spelling of a path this tab writes, when the config target uses one. `source()` reads the raw files, so
 * it cannot see a value that only exists under the legacy key. Lists the same paths as `aliasOf` in
 * `src/config-file-edit.ts`, for the paths written here.
 */
export function legacyPath(path: string[]): string[] | undefined {
  if (path.length === 1 && path[0] === "snapshots") return ["snapshot"]
  if (path.length === 3 && path[0] === "compaction" && path[1] === "keep" && path[2] === "tokens")
    return ["compaction", "preserve_recent_tokens"]
  if (path.length === 2 && path[0] === "compaction" && path[1] === "buffer") return ["compaction", "reserved"]
  return undefined
}

type Scope = "global" | "project"

/**
 * The file an edit must land in so the merged config changes. A project document wins when it defines either
 * spelling; otherwise keep the existing target, or the global file for a key no document defines.
 */
export function writeScope(source: (path: string[]) => Scope | undefined, path: string[]): Scope {
  const legacy = legacyPath(path)
  const written = legacy ? [path, legacy] : [path]
  if (written.some((candidate) => source(candidate) === "project")) return "project"
  // Core replaces the whole top-level value of a document, so a project section shadows every leaf under it.
  if (path.length > 1 && source([path[0]!]) === "project") return "project"
  for (const candidate of written) {
    const scope = source(candidate)
    if (scope) return scope
  }
  return "global"
}
