import type { ShellID } from "@/tool/shell/id"
import type { Node } from "web-tree-sitter"

export function heredocs(root: Node, kind: ShellID.Kind) {
  if (kind !== "bash") return {}
  return root.descendantsOfType("heredoc_redirect").length > 0 ? { heredoc: true } : {}
}
