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
  const joined = new Map(stray(root).map((item) => [item.error.id, item.text]))
  const failed = root
    .descendantsOfType("ERROR")
    .filter((node): node is Node => Boolean(node))
    .filter((node) => node.descendantsOfType("command_name").length > 0)
    .map((node) => (joined.get(node.id) ?? node.text).trim())
    .filter((text) => text.length > 0)
  if (failed.length > 0) return failed
  const raw = root.text.trim()
  return raw ? [raw] : []
}

// The same grammar failure splits a command at a bare `--` or at `, ` in an
// argument list when the next token starts with `.` (Kilo-Org/kilocode#15938).
// The ERROR node keeps the command head and the tail is parsed as a separate
// `command` that PowerShell never runs on its own. Matching the tail alone
// produced false denials and let deny rules for later arguments miss the
// command. Join each tail onto its ERROR text on the same line so the whole
// command is matched once. A tail after `;`, `|` or a newline is a real
// statement (for example a dot-source invocation) and stays a command.
export function stray(root: Node): { error: Node; command: Node; text: string }[] {
  if (!root.hasError) return []
  const errors = root
    .descendantsOfType("ERROR")
    .filter((node): node is Node => Boolean(node))
    .filter((node) => node.descendantsOfType("command_name").length > 0)
  const all = root.descendantsOfType("command").filter((node): node is Node => Boolean(node))
  const out: { error: Node; command: Node; text: string }[] = []
  for (const error of errors) {
    if (error.parent?.type === "ERROR") continue
    const tail = all.find((node) => {
      if (node.startIndex < error.endIndex) return false
      return /^[ \t]*$/.test(root.text.slice(error.endIndex, node.startIndex))
    })
    if (!tail) continue
    out.push({ error, command: tail, text: root.text.slice(error.startIndex, tail.endIndex) })
  }
  return out
}
