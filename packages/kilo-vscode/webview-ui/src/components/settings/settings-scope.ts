/**
 * The legacy spelling of a path this tab writes, when the config target uses one. `source()` reads the raw files, so
 * it cannot see a value that only exists under the legacy key. Mirrors `aliasOf` in `src/config-file-edit.ts` for the
 * paths written here.
 */
export function legacyPath(path: string[]): string[] | undefined {
  if (path.length === 1 && path[0] === "snapshots") return ["snapshot"]
  if (path.length === 3 && path[0] === "compaction" && path[1] === "keep" && path[2] === "tokens")
    return ["compaction", "preserve_recent_tokens"]
  if (path.length === 2 && path[0] === "compaction" && path[1] === "buffer") return ["compaction", "reserved"]
  return undefined
}

/**
 * The file an edit must land in so the merged config changes. A project document wins when it defines either
 * spelling; otherwise keep the existing target, or the global file for a key no document defines.
 */
type Scope = "global" | "project"

export function writeScope(source: (path: string[]) => Scope | undefined, path: string[]): Scope {
  const legacy = legacyPath(path)
  if (source(path) === "project") return "project"
  if (legacy && source(legacy) === "project") return "project"
  return source(path) ?? (legacy ? source(legacy) : undefined) ?? "global"
}
