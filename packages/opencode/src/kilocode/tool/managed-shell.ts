import type { PolicyShell } from "@kilocode/kilo-gateway/permission-policy"
import { Shell } from "@opencode-ai/core/shell"
import type { Node } from "web-tree-sitter"

const BASH = new Set(["program", "list", "pipeline", "redirected_statement"])
const PS = new Set(["program", "statement_list", "empty_statement", "pipeline", "pipeline_chain"])
const OPERATORS = new Set([";", "\n", "&&", "||", "|"])
const REDIRECTS = new Set([">", ">>", ">|", "&>", "&>>", "<", "<>"])
const BARE = /^[\w./:+%,=@-]+$/
const NAME = /^[\w./:+\\-]+$/
const NONSPACE = /[^ \t\r\n]/
const DISPATCH = new Set([
  ".",
  "alias",
  "builtin",
  "command",
  "enable",
  "eval",
  "exec",
  "source",
  "trap",
  "invoke-command",
  "invoke-expression",
  "start-process",
  "start-job",
  "start-threadjob",
  "icm",
  "iex",
  "saps",
])
const LOCATIONS = new Set([
  "cd",
  "chdir",
  "pushd",
  "popd",
  "set-location",
  "push-location",
  "pop-location",
  "sl",
  "sp",
  "pp",
])

export function shellKind(shell: string): PolicyShell["kind"] {
  if (Shell.ps(shell)) return "powershell"
  return Shell.name(shell) === "bash" ? "bash" : "unsupported"
}

function covered(node: Node) {
  // Some grammar recovery drops tokens without emitting an ERROR node. Only
  // whitespace may occur between the direct children of the nodes we trust.
  const text = node.text
  let pos = 0
  for (const child of node.children) {
    if (!child) return false
    if (NONSPACE.test(text.slice(pos, child.startIndex - node.startIndex))) return false
    pos = child.endIndex - node.startIndex
  }
  return !NONSPACE.test(text.slice(pos))
}

function literal(node: Node, ps: boolean): string | undefined {
  const text = node.text
  if (ps) {
    switch (node.type) {
      case "command_name":
      case "generic_token":
      case "command_parameter":
        return BARE.test(text) || /^[\w.:/\\-]+$/.test(text) ? text : undefined
      case "decimal_integer_literal":
        return /^\d+$/.test(text) ? text : undefined
      case "expandable_string_literal":
        return /^"[^"`$]*"$/.test(text) ? text.slice(1, -1) : undefined
      case "verbatim_string_characters":
        return /^'[^']*'$/.test(text) ? text.slice(1, -1) : undefined
      case "command_name_expr":
      case "array_literal_expression":
      case "unary_expression":
      case "string_literal":
      case "integer_literal": {
        const child = node.namedChildCount === 1 && node.namedChild(0)
        if (child && child.text === text) return literal(child, ps)
      }
    }
    return undefined
  }
  if (node.type === "word" || node.type === "number") {
    if (BARE.test(text)) return text
    if (/^(?:[\w./:+%,=@-]|\\[\w./:+%,=@-])+$/.test(text)) return text.replace(/\\(.)/g, "$1")
    return undefined
  }
  if (node.type === "concatenation" && covered(node)) {
    const words = node.namedChildren.map((child) => child && literal(child, ps))
    if (words.every((word) => typeof word === "string")) return words.join("")
  }
  if (node.type === "raw_string" && /^'[^']*'$/.test(text)) return text.slice(1, -1)
  if (node.type === "string" && /^"[^"\\`$]*"$/.test(text)) return text.slice(1, -1)
  return undefined
}

export function classify(root: Node, shell: string, input: string): { managedShell: PolicyShell; paths: Set<string> } {
  const kind = shellKind(shell)
  const commands = new Set<string>()
  const paths = new Set<string>()
  if (kind === "unsupported") return { managedShell: { kind, commands: [], uncertain: true }, paths }

  const ps = kind === "powershell"
  const structural = ps ? PS : BASH
  let uncertain = root.hasError || NONSPACE.test(input.slice(0, root.startIndex) + input.slice(root.endIndex))
  let location = false
  let count = 0

  function redirect(node: Node) {
    uncertain = true
    if (!ps && !node.children.some((child) => child && REDIRECTS.has(child.type))) return
    const targets = ps
      ? (node.namedChildren
          .find((child) => child?.type === "redirected_file_name")
          ?.namedChildren.filter((child) => child?.type !== "command_argument_sep") ?? [])
      : node.childrenForFieldName("destination")
    for (const target of targets) {
      const file = target && literal(target, ps)
      if (file && file !== "/dev/null") paths.add(file)
    }
  }

  function command(node: Node) {
    count++
    const head = node.childForFieldName(ps ? "command_name" : "name")
    const word = ps ? head : head?.namedChild(0)
    const name = word && literal(word, ps)
    const elements = ps ? node.childForFieldName("command_elements") : undefined
    const args = (ps ? (elements?.namedChildren ?? []) : node.childrenForFieldName("argument")).filter(
      (arg): arg is Node => !!arg,
    )
    const ids = new Set(args.map((arg) => arg.id))
    const text: string[] = []
    if (!covered(node) || (elements && !covered(elements))) uncertain = true
    for (const child of node.namedChildren) {
      if (!child || child.id === head?.id || child.id === elements?.id || ids.has(child.id)) continue
      visit(child)
    }
    for (const arg of args) {
      if (arg.type === "command_argument_sep" && !NONSPACE.test(arg.text)) continue
      if (arg.type === "redirection") {
        visit(arg)
        continue
      }
      const value = literal(arg, ps)
      if (value === undefined) visit(arg)
      text.push(value && BARE.test(value) ? value : arg.text)
    }
    if (!name || !NAME.test(name)) {
      uncertain = true
      if (word) visit(word)
      return
    }
    commands.add([name, ...text].join(" "))
    const key = ps ? name.toLowerCase() : name
    if (DISPATCH.has(key)) uncertain = true
    if (LOCATIONS.has(key)) location = true
    if (/^(?:[./]+[\\/]|[A-Za-z]:[\\/]|[\\/])/.test(name)) paths.add(name)
  }

  function visit(node: Node) {
    if (node.type === "comment") return
    if (node.type === "command") return command(node)
    if (node.type === "file_redirect" || node.type === "redirection") redirect(node)
    if (!structural.has(node.type) || !covered(node)) uncertain = true
    // Don't discard recognizable descendants of an unsupported construct.
    // Their denials still apply alongside the uncertainty fallback.
    for (const child of node.children) {
      if (!child) {
        uncertain = true
        continue
      }
      if (child.isNamed) visit(child)
      else if (!OPERATORS.has(child.type)) uncertain = true
    }
  }

  visit(root)
  return {
    managedShell: { kind, commands: [...commands], uncertain: uncertain || !commands.size || (location && count > 1) },
    paths,
  }
}
