import type { Node } from "web-tree-sitter"
import type { ShellID } from "@/tool/shell/id"

// The read-only bash rulesets deny shell operators with globs such as `*>*`,
// `*|*`, `*;*` and `*$(*`, which match the character anywhere in the pattern.
// The shell tool used the raw command text as that pattern, so a `|` inside a
// quoted grep regex or a `2>/dev/null` redirect denied a read-only command.
//
// `pattern` renders the permission pattern from the tree-sitter parse instead of
// re-lexing the text. Operator characters are masked with `_` only where the
// parser proves they are inert: inside literal tokens (quoted strings, ANSI-C
// strings, escaped words, heredoc bodies) and inside redirects that cannot touch
// a file (`/dev/null` targets and fd duplication such as `2>&1`). Every other
// byte is emitted verbatim, so real operators, real redirects, `$(...)`,
// backticks and `<(...)` still reach the blocklist. Anything the parser did not
// classify (errors, non-bash grammars) falls back to the raw text, so the result
// is never more permissive than the input.

const MASK = "_"
const OPERATORS = /[<>|&;$`\n]/g
const LITERAL = new Set(["word", "number", "string_content", "raw_string", "ansi_c_string", "heredoc_start"])
const DISCARD = new Set([">", ">>", ">|", "&>", "&>>", "<"])
const DUP = new Set([">&", "<&"])
const CLOSE = new Set([">&-", "<&-"])
// Whitespace between children of these nodes is literal text, so a newline
// there is not a command separator.
const TEXT = new Set(["string", "heredoc_redirect"])

function mask(text: string) {
  return text.replace(OPERATORS, MASK)
}

// A redirect is inert when it writes to or reads from /dev/null, or only
// duplicates or closes a file descriptor.
function inert(node: Node) {
  const op = node.children.find((child) => child && !child.isNamed)?.type
  if (!op) return false
  if (CLOSE.has(op)) return true
  const target = node.children.findLast((child) => child?.isNamed)
  if (!target || target.type === "file_descriptor") return false
  if (DISCARD.has(op)) return target.type === "word" && target.text === "/dev/null"
  if (DUP.has(op)) return target.type === "number" || target.text === "-"
  return false
}

function render(node: Node, text: boolean): string {
  if (LITERAL.has(node.type) && node.childCount === 0) return mask(node.text)
  if (node.type === "heredoc_body" && node.childCount === 0) return mask(node.text)
  if (node.type === "file_redirect" && inert(node)) return mask(node.text)
  if (node.childCount === 0) return node.text
  const inside = text || TEXT.has(node.type)
  let out = ""
  let pos = node.startIndex
  for (const child of node.children) {
    if (!child) continue
    const gap = node.text.slice(pos - node.startIndex, child.startIndex - node.startIndex)
    out += inside ? gap.replaceAll("\n", MASK) : gap
    out += render(child, inside)
    pos = child.endIndex
  }
  return out + node.text.slice(pos - node.startIndex)
}

// Permission pattern for one parsed command node. `fallback` is the raw source
// the shell tool used before (the command with its redirects); it is returned
// unchanged for non-bash grammars and for parses with errors.
export function pattern(node: Node, kind: ShellID.Kind, fallback: string) {
  const root = node.parent?.type === "redirected_statement" ? node.parent : node
  if (kind !== "bash" || root.hasError) return fallback
  return render(root, false)
}
