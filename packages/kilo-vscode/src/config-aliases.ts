// The v1 key aliases of a v2 config path, shared by the host (alias removal on write) and the webview (scope lookup).
// Every legacy key `packages/core/src/config/normalize.ts` still reads is listed here.
function readPath(source: unknown, path: string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Which scope defines a setting, checking the v2 path and its v1 aliases. The merge replaces one top-level key at a
 * time, so shadowing happens per root: `agents` and its aliases such as `small_model` and `agent` are separate keys
 * that survive the merge independently, and each may be owned by a different scope. Resolve the owner per root, then
 * report the owner of the first candidate (the v2 path, then each alias in precedence order) that defines a value.
 */
export function scopeOf(path: string[], project: unknown, global: unknown): "project" | "global" | undefined {
  if (path.length === 0) return undefined
  const sources = { project, global } as const
  const ownerOf = (root: string | undefined): "project" | "global" | undefined => {
    if (root === undefined) return undefined
    if (hasRoot(project, root)) return "project"
    return hasRoot(global, root) ? "global" : undefined
  }
  for (const candidate of [path, ...aliasOf(path)]) {
    const owner = ownerOf(candidate[0])
    if (owner && readPath(sources[owner], candidate) !== undefined) return owner
  }
  return undefined
}

function hasRoot(source: unknown, root: string): boolean {
  return typeof source === "object" && source !== null && !Array.isArray(source) && root in source
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
