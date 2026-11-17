import type { Node } from "web-tree-sitter"

// tree-sitter-powershell treats a bare token that starts with `.` after `--`
// or a comma as its own command (`Write-Output -- .agents/README.md` becomes
// an ERROR head plus a command named `.agents/README.md`). PowerShell runs
// that as one command. A real invocation still has a call operator
// (`. ./script.ps1`, `& cmd`) and is left alone. Kilo-Org/kilocode#15938.

export type Cover = { start: number; end: number }

export type Fold = {
  /** `${start}:${end}` of command nodes that belong to a reconstructed statement. */
  skip: Set<string>
  /** One permission pattern per reconstructed statement. */
  patterns: string[]
  /** Source ranges already represented by `patterns`. */
  covers: Cover[]
}

export function fold(root: Node): Fold {
  const skip = new Set<string>()
  const patterns: string[] = []
  const covers: Cover[] = []
  const text = root.text
  const seen = new Set<string>()
  const commands = named(root, "command")
  const errors = named(root, "ERROR")

  for (const command of commands) {
    if (skip.has(key(command)) || !dotArgument(command)) continue
    // The failed head is the ERROR that ends where this command begins.
    // `--` and `,` are what push the grammar into that ERROR; the dot token
    // itself may come after other arguments (`git ls-files -- README.md .agents/README.md`).
    const error = errors
      .filter(
        (node) => node.endIndex <= command.startIndex && /^[ \t]*$/.test(text.slice(node.endIndex, command.startIndex)),
      )
      .sort((a, b) => a.startIndex - b.startIndex)[0]
    if (!error) continue

    // Stop at this argument. A later pipeline stage (`| Set-Content ...`) is a
    // separate command and keeps its own permission pattern and path scan.
    const start = error.startIndex
    const end = command.endIndex
    const span = `${start}:${end}`
    if (seen.has(span)) continue
    seen.add(span)
    const pattern = text.slice(start, end).trim()
    if (!pattern) continue
    patterns.push(pattern)
    covers.push({ start, end })
    skip.add(key(command))
  }

  return { skip, patterns, covers }
}

export function commandKey(node: Node) {
  return key(node)
}

function key(node: Node) {
  return `${node.startIndex}:${node.endIndex}`
}

function named(root: Node, type: string) {
  return root.descendantsOfType(type).filter((node): node is Node => Boolean(node))
}

function dotArgument(command: Node) {
  for (let i = 0; i < command.childCount; i++) {
    const child = command.child(i)
    if (child?.type === "command_invokation_operator") return false
  }
  for (let i = 0; i < command.childCount; i++) {
    const child = command.child(i)
    if (child?.type === "command_name") return child.text.startsWith(".")
  }
  return false
}


