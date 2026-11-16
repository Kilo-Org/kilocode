import type { Node } from "web-tree-sitter"
import { stray } from "./shell-unparsed"

// Recovery for commands the PowerShell grammar splits in two (Kilo-Org/kilocode#15938).
// The head stays in an ERROR node and the tail parses as a separate `command`
// that is never run on its own. The scanner keeps scanning paths on every
// original node, treats the tail as arguments of its head, and skips only the
// pattern entries that the joined pattern from `unparsed` covers. A covered head
// still contributes its `always` prefix; the tail contributes none.
export function recover(root: Node, nodes: Node[]) {
  const joined = stray(root)
  const covered = (node: Node) =>
    joined.some((item) => item.command.id === node.id || item.error.id === node.parent?.id)
  return {
    kept: nodes.filter((node) => !covered(node)),
    covered,
    // Heads the grammar left as bare tokens in the ERROR node (no `command` child).
    bare: joined
      .filter((item) => item.error.descendantsOfType("command").length === 0)
      .map((item) =>
        item.error.children
          .filter((child): child is Node => Boolean(child) && child!.type !== "command_argument_sep")
          .map((child) => child.text.replace(/,$/, "")),
      ),
    head: (node: Node) => joined.some((item) => item.error.id === node.parent?.id),
    tail: (node: Node): Node[] =>
      joined.filter((item) => item.error.id === node.parent?.id).map((item) => item.command),
  }
}
