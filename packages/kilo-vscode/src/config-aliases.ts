// The v1 key aliases of a v2 config path, shared by the host (alias removal on write) and the webview (scope lookup).
// Every legacy key `packages/core/src/config/normalize.ts` still reads is listed here.
export function aliasOf(keyPath: string[]): string[][] {
  if (keyPath.length === 0) return []
  if (keyPath[0] === "agents") {
    if (keyPath.length === 3 && keyPath[1] === "title" && keyPath[2] === "model") return [["small_model"]]
    const tail = keyPath.slice(2)
    if (tail.length === 1 && tail[0] === "system")
      return [
        ["agent", keyPath[1]!, "prompt"],
        ["mode", keyPath[1]!, "prompt"],
      ]
    if (tail.length === 1 && tail[0] === "disabled")
      return [
        ["agent", keyPath[1]!, "disable"],
        ["mode", keyPath[1]!, "disable"],
      ]
    return [
      ["agent", ...keyPath.slice(1)],
      ["mode", ...keyPath.slice(1)],
    ]
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
