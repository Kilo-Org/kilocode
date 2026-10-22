import type { Node } from "web-tree-sitter"

// tree-sitter-powershell drops commands containing a bare `--` into ERROR nodes
// instead of command nodes, so the shell permission scanner collected zero
// patterns and skipped the check entirely (Kilo-Org/kilocode#12326). Recover
// the failed command text from ERROR nodes, and fail closed with the raw input
// whenever the parse has errors and nothing else was recovered, so every
// executed command yields at least one permission pattern. The raw fallback
// also covers ERROR chunks without a command_name descendant (for example
// PowerShell backtick escapes), which can still contain runnable text.
export function unparsed(root: Node, commands: number): string[] {
  if (!root.hasError && commands > 0) return []
  const failed = root
    .descendantsOfType("ERROR")
    .filter((node): node is Node => Boolean(node))
    .filter((node) => node.descendantsOfType("command_name").length > 0)
    .map((node) => node.text.trim())
    .filter((text) => text.length > 0)
  if (failed.length > 0) return failed
  const raw = root.text.trim()
  return raw ? [raw] : []
}
