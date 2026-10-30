// The v1 key aliases of a v2 config path, shared by the host (alias removal on write) and the webview (scope lookup).
// Every legacy key `packages/core/src/config/normalize.ts` still reads is listed here.
/**
 * The scope whose file a setting is read from and written to. The merge replaces one v2 top-level key at a time and
 * the project document is later than the global one, so the scope that defines that key, directly or through a v1
 * alias root such as `tools` or `small_model`, owns the setting and any write to an earlier file would be shadowed.
 * Project wins over global, as in the merge. The leaf itself is not required: a scope that owns the key owns every
 * leaf under it, including one it does not define yet, so a new value is written where the merge will keep it.
 */
export function scopeOf(path: string[], project: unknown, global: unknown): "project" | "global" | undefined {
  if (path.length === 0) return undefined
  const roots = [path[0], ...aliasOf(path).map((alias) => alias[0])]
  if (owns(project, roots)) return "project"
  if (owns(global, roots)) return "global"
  return undefined
}

function owns(source: unknown, roots: (string | undefined)[]): boolean {
  return (
    typeof source === "object" &&
    source !== null &&
    !Array.isArray(source) &&
    roots.some((root) => root !== undefined && root in source)
  )
}

export function aliasOf(keyPath: string[]): string[][] {
  if (keyPath.length === 0) return []
  if (keyPath[0] === "agents") {
    if (keyPath.length === 1) return [["small_model"], ["agent"], ["mode"]]
    const field = keyPath[1]!
    const tail = keyPath.slice(2)
    const mapped =
      tail.length === 1 && tail[0] === "system"
        ? ["prompt"]
        : tail.length === 1 && tail[0] === "disabled"
          ? ["disable"]
          : tail
    const generic = [
      ["agent", field, ...mapped],
      ["mode", field, ...mapped],
    ]
    // `small_model` feeds only `agents.title.model`; a whole-title or model write replaces it too.
    if (field === "title" && (tail.length === 0 || (tail.length === 1 && tail[0] === "model")))
      return [["small_model"], ...generic]
    return generic
  }
  if (keyPath[0] === "mcp" && keyPath[1] === "servers" && keyPath.length >= 3) return [["mcp", ...keyPath.slice(2)]]
  if (keyPath[0] === "compaction") {
    if (keyPath[1] === "keep") return [["compaction", "preserve_recent_tokens"]]
    if (keyPath[1] === "buffer" && keyPath.length === 2) return [["compaction", "reserved"]]
    return []
  }
  if (keyPath[0] === "policies")
    return [["enabled_providers"], ["disabled_providers"], ["experimental", "policies"]]
  const top: Record<string, string[]> = {
    permissions: ["permission", "tools"],
    commands: ["command"],
    providers: ["provider"],
    snapshots: ["snapshot"],
    plugins: ["plugin"],
    media: ["attachment"],
    update: ["autoupdate"],
    share: ["autoshare"],
    references: ["reference"],
  }
  const mapped = top[keyPath[0]!]
  return mapped ? mapped.map((alias) => [alias, ...keyPath.slice(1)]) : []
}
