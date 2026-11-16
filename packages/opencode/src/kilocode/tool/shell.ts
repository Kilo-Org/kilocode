import type { Node } from "web-tree-sitter"
import { stray } from "./shell-unparsed"

// Recovery for commands the PowerShell grammar splits in two (Kilo-Org/kilocode#15938).
// The head stays in an ERROR node and the tail parses as a separate `command`
// that is never run on its own. The scanner keeps scanning paths on every
// original node, treats the tail as arguments of its head, and skips only the
// pattern and `always` entries that the joined pattern from `unparsed` covers.
export function recover(root: Node, nodes: Node[]) {
  const joined = stray(root)
  const covered = (node: Node) =>
    joined.some((item) => item.command.id === node.id || item.error.id === node.parent?.id)
  return {
    kept: nodes.filter((node) => !covered(node)),
    covered,
    tail: (node: Node): Node[] =>
      joined.filter((item) => item.error.id === node.parent?.id).map((item) => item.command),
  }
}
