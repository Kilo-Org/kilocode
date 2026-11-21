import type { Node } from "web-tree-sitter"

/**
 * Parse, composition and file-effect facts the deterministic security layer consumes.
 *
 * The shell tool already walks the tree-sitter AST for permission patterns, so these facts are read
 * off that same walk: the layer must never run a second parser whose view could disagree with the
 * one that produced the patterns. Anything the grammar could not recover fails closed to
 * `complete: false`, and an executable name is reported only for a single, uncomposed command.
 *
 * File effects exist so that the same real side effect gets the same decision whichever route
 * produced it: appending to a git hook through a redirect has to reach the rule that an `edit` of
 * that hook reaches. Only structurally unambiguous effects are reported; a target the grammar shows
 * as an expansion, a substitution or a glob is reported *without* a path, which the core reads as an
 * unknown target and holds at ask. Everything here is pure AST work — resolving a target text to an
 * absolute path stays in the scanner, which owns the cwd, the shell and the environment.
 */
/** Sequencing: it decides the order in which fully parsed commands run, nothing more. */
const SEQUENCE = ["pipeline", "list"] as const

/**
 * Composition that changes *what* runs. A substitution builds the command line from the output of
 * another command, a subshell hides its contents from the effect walk and a heredoc feeds a body
 * the grammar does not model as a command. None of these can be judged element by element.
 */
const REWRITING = ["command_substitution", "process_substitution", "subshell", "heredoc_redirect"] as const

/** Shell commands whose normal operation can expose values inherited from the parent process. */
const ENVIRONMENT = new Set(["declare", "env", "export", "printenv", "set", "typeset"])

/**
 * Node types and command names that rewrite the environment a later command resolves in.
 *
 * `PATH` decides which file a bare `ls` is, and the loader variables decide what that file then
 * pulls in, so any of these makes every executable *name* in the run unproven. A standalone
 * assignment is not a `command` node at all (`PATH=/x && ls` parses the assignment as a sibling of
 * the command), which is exactly why this is checked over the whole tree rather than per command.
 */
const ENVIRONMENT_NODES = [
  "variable_assignment",
  "declaration_command",
  "unset_command",
  "unsetenv_command",
  "function_definition",
] as const

/** Commands that install a name, replace the shell's own state or read a file into it. */
const ENVIRONMENT_COMMANDS = new Set(["alias", "unalias", "source", ".", "shopt", "ulimit", "umask"])

/**
 * The name a command token actually selects, plus whether it selected it by path.
 *
 * Quoting and escaping change the spelling of an executable without changing which program runs, so
 * `"rm"`, `'r''m'` and `\rm` have to reach the same rules `rm` reaches — otherwise the layer is
 * bypassed by punctuation. A separator is the opposite case: `/bin/rm` names a *file*, so its
 * basename tells us what file semantics to expect but must never buy a name-based fast path.
 */
export function canonicalCommand(text: string, posix = true): { name: string; pathed: boolean } {
  const trimmed = text.trim()
  let plain = ""
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!
    // A backslash escapes the next character in POSIX shells; in PowerShell and cmd it separates.
    if (posix && ch === "\\" && i + 1 < trimmed.length) {
      plain += trimmed[i + 1]
      i++
      continue
    }
    if (ch === '"' || ch === "'") continue
    plain += ch
  }
  const cut = Math.max(plain.lastIndexOf("/"), posix ? -1 : plain.lastIndexOf("\\"))
  return { name: cut >= 0 ? plain.slice(cut + 1) : plain, pathed: cut >= 0 }
}

/** One command of a sequence, as the security layer sees it. */
export type ShellCommandFacts = {
  executable?: string
  argv?: string[]
  classified?: boolean
  /** The command can expose inherited process environment through expansion or its own operation. */
  ambient?: boolean
  /**
   * The executable was named by a path rather than looked up on `PATH`. The name then identifies a
   * file the run chose, not the program the allowlists were written about, so no name-based fast
   * path may be taken for it.
   */
  pathed?: boolean
  /**
   * The run modifies its own execution environment — a prefix assignment on this command, or an
   * assignment, `export`, alias or function definition anywhere in the line. `PATH` and the loader
   * variables decide which file a bare name resolves to, so a name proves nothing once this holds.
   */
  assigns?: boolean
}

export type ShellSecurityFacts = {
  complete: boolean
  composed: boolean
  executable?: string
  /** The parsed command line. Present only for a single, fully recovered, uncomposed command. */
  argv?: string[]
  /**
   * True when the executable's own file semantics are known — it is in the effect table above, so
   * its effects were extracted rather than merely absent. A redirect alone never classifies a
   * command: `npm test > out.log` has an effect but the program itself is still arbitrary.
   */
  classified?: boolean
  /**
   * True when every command the run will execute was recovered and the composition is pure
   * sequencing, so each element can be judged on its own instead of the whole line staying opaque.
   */
  decomposable?: boolean
  /** The recovered commands, in source order. Present only when `decomposable`. */
  commands?: ShellCommandFacts[]
  /** See `ShellCommandFacts.pathed`. */
  pathed?: boolean
  /** See `ShellCommandFacts.assigns`. */
  assigns?: boolean
}

/** Argument node types that carry a token of the command line. Redirects are effects, not argv. */
const ARGV = new Set([
  "command_name",
  "word",
  "string",
  "raw_string",
  "concatenation",
  "number",
  "simple_expansion",
  "expansion",
])

function argv(node: Node): string[] {
  const out: string[] = []
  const walk = (parent: Node) => {
    for (let i = 0; i < parent.namedChildCount; i++) {
      const child = parent.namedChild(i)
      if (!child) continue
      if (child.type === "file_redirect" || child.type === "redirection") continue
      if (child.type === "command_elements") {
        walk(child)
        continue
      }
      if (!ARGV.has(child.type)) continue
      out.push(child.text)
    }
  }
  walk(node)
  return out
}

function present(root: Node, types: readonly string[]) {
  return types.some((type) => root.descendantsOfType(type).some((node) => Boolean(node)))
}

function unit(node: Node, posix: boolean, environment: boolean): ShellCommandFacts {
  const token = node.descendantsOfType("command_name")[0]?.text
  const canonical = token === undefined ? undefined : canonicalCommand(token, posix)
  const name = canonical?.name
  // A prefix assignment (`PATH=/x ls`) lives inside the command node; anything else that touches the
  // environment is a property of the whole line and arrives as `environment`.
  const assigns = environment || node.descendantsOfType("variable_assignment").some((child) => Boolean(child))
  return {
    ...(name ? { executable: name } : {}),
    argv: argv(node),
    // The effect table describes the standard program resolved by a bare name. A path-selected
    // executable or a rewritten environment may resolve to different code with the same basename;
    // keep its visible file effects, but do not treat the executable itself as classified.
    classified: name !== undefined && commandOperation(name) !== undefined && !canonical?.pathed && !assigns,
    ambient: ENVIRONMENT.has(name ?? "") || present(node, ["simple_expansion", "expansion", "arithmetic_expansion"]),
    ...(canonical?.pathed ? { pathed: true } : {}),
    ...(assigns ? { assigns: true } : {}),
  }
}

/** True when anything in the run rewrites the environment later commands resolve their names in. */
function environmentRewrite(root: Node, commands: readonly Node[], posix: boolean) {
  if (present(root, ENVIRONMENT_NODES)) return true
  return commands.some((node) => {
    const token = node.descendantsOfType("command_name")[0]?.text
    return token !== undefined && ENVIRONMENT_COMMANDS.has(canonicalCommand(token, posix).name)
  })
}

export function securityFacts(
  root: Node,
  unrecovered: number,
  commands: readonly Node[],
  posix = true,
): ShellSecurityFacts {
  const complete = !root.hasError && unrecovered === 0
  const rewriting = present(root, REWRITING)
  const composed = commands.length > 1 || rewriting || present(root, SEQUENCE)
  const decomposable = complete && !rewriting
  const environment = environmentRewrite(root, commands, posix)
  const units = decomposable ? commands.map((node) => unit(node, posix, environment)) : []
  const facts = {
    complete,
    composed,
    decomposable,
    ...(environment ? { assigns: true } : {}),
    ...(units.length > 0 ? { commands: units } : {}),
  }
  if (!complete || composed || commands.length !== 1) return facts
  return { ...facts, ...units[0] }
}

/** The file operations the layer can name. They mirror the operations structured file tools report. */
export type ShellOperation = "read" | "update" | "delete" | "move"

/** A target the scanner still has to resolve. No `text` means the grammar showed nothing static. */
export type ShellEffectTarget = { operation: ShellOperation; text?: string }

/** A resolved effect. No `path` means the target could not be determined and must fail closed. */
export type ShellEffect = { operation: ShellOperation; path?: string }

/**
 * Commands whose file effect is unambiguous from the command name alone. Deliberately the same set
 * the scanner already treats as path-bearing (`FILES` / `CMD_FILES` in `tool/shell.ts`) minus the
 * directory-changing ones, so the two never disagree about which arguments are paths.
 *
 * Copy and link report `update` on every argument including the source: over-reporting a read as a
 * write can only tighten the decision, never loosen it.
 */
const OPERATIONS: Record<string, ShellOperation> = {
  cat: "read",
  "get-content": "read",
  type: "read",
  head: "read",
  tail: "read",
  wc: "read",
  nl: "read",
  stat: "read",
  file: "read",
  ls: "read",
  diff: "read",
  rm: "delete",
  "remove-item": "delete",
  del: "delete",
  erase: "delete",
  rd: "delete",
  rmdir: "delete",
  mv: "move",
  "move-item": "move",
  move: "move",
  ren: "move",
  rename: "move",
  "rename-item": "move",
  cp: "update",
  "copy-item": "update",
  copy: "update",
  touch: "update",
  mkdir: "update",
  md: "update",
  "new-item": "update",
  chmod: "update",
  chown: "update",
  "set-content": "update",
  "add-content": "update",
}

export function commandOperation(cmd: string): ShellOperation | undefined {
  return OPERATIONS[cmd]
}

/**
 * Commands whose operands have different roles: everything but one operand is a source, and the
 * remaining one is the destination the command writes. Treating them as one undifferentiated
 * operation is wrong in both directions — it reports reading a hook as writing one, and it lets a
 * destination inside a protected directory hide behind a source that is not.
 */
const COPY = new Set(["cp", "copy", "copy-item"])
const RENAME = new Set(["mv", "move", "move-item", "ren", "rename", "rename-item"])

/**
 * Options whose value is the destination rather than an operand. With one of these present every
 * positional operand is a source, so the last-operand rule must not be applied.
 */
const TARGET_OPTIONS = new Set(["-t", "--target-directory"])

/** The value a path-valued option carries, whether it is spelled `--opt=value` or `--opt value`. */
export function optionValue(tokens: readonly string[], flags: ReadonlySet<string>): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    const eq = token.indexOf("=")
    if (eq > 0 && flags.has(token.slice(0, eq))) return token.slice(eq + 1) || undefined
    if (flags.has(token)) return tokens[i + 1]
  }
  return undefined
}

/**
 * The operation each resolved path argument carries, index-aligned with `paths`.
 *
 * `paths` is the scanner's own ordered list of path-bearing arguments for this command, so the
 * destination is identified positionally rather than by re-parsing the command line: the two views
 * must not be able to disagree about which token is which.
 */
export function commandEffects(
  cmd: string,
  tokens: readonly string[],
  paths: readonly string[],
): (ShellOperation | undefined)[] {
  const operation = commandOperation(cmd)
  if (!operation) return paths.map(() => undefined)
  const copy = COPY.has(cmd)
  const rename = RENAME.has(cmd)
  if ((!copy && !rename) || paths.length === 0) return paths.map(() => operation)

  const targeted = optionValue(tokens, TARGET_OPTIONS)
  const destination = targeted !== undefined ? paths.indexOf(targeted) : paths.length - 1
  // A destination the option named but the scanner did not report as a path leaves nothing to
  // anchor on; keep every operand at the stricter write role rather than guessing.
  if (destination < 0) return paths.map(() => (copy ? "update" : operation))
  // Copy reads its sources and writes its destination. Rename destroys the source and creates the
  // destination, so both stay on the destructive `move` the command already reported.
  return paths.map((_, index) => (index === destination ? (copy ? "update" : operation) : copy ? "read" : operation))
}

/** Argument node types the scanner's token walk drops, so their target is never statically known. */
const DYNAMIC = ["simple_expansion", "expansion", "arithmetic_expansion", "command_substitution"] as const

/**
 * True when a command carries an argument the grammar shows as an expansion or substitution. Those
 * never appear in the scanner's token list, so without this the effect would vanish instead of
 * being recorded as an unknown target.
 */
export function dynamicArguments(node: Node): boolean {
  return DYNAMIC.some((type) => node.descendantsOfType(type).some((child) => Boolean(child)))
}

/** Destination node types that carry a statically readable path. */
const STATIC = new Set(["word", "string", "raw_string", "concatenation"])

function operator(node: Node): ShellOperation | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child || child.isNamed) continue
    // `>&` / `<&` duplicate a descriptor and touch no file; `&>` still redirects into one.
    if (child.type.endsWith("&")) return undefined
    if (child.type.includes(">")) return "update"
    if (child.type.includes("<")) return "read"
  }
  return undefined
}

function destination(node: Node) {
  const field = node.childForFieldName("destination")
  if (field) return field
  for (let i = node.namedChildCount - 1; i >= 0; i--) {
    const child = node.namedChild(i)
    if (child) return child
  }
  return undefined
}

/**
 * Redirect targets, as texts the scanner still has to resolve.
 *
 * A descriptor redirect (`2>&1`) moves no file and is skipped. A shell whose grammar reports
 * redirections we cannot read structurally yields one target with no text, so the effect is
 * recorded as unknown rather than silently dropped.
 */
export function redirectTarget(node: Node): ShellEffectTarget | undefined {
  const operation = operator(node)
  if (!operation) return undefined
  const target = destination(node)
  if (!target || target.type === "file_descriptor") return undefined
  return STATIC.has(target.type) ? { operation, text: target.text } : { operation }
}

/** Every `file_redirect` in the tree, in source order, so a caller can interleave them with commands. */
export function redirectNodes(root: Node): Node[] {
  return root.descendantsOfType("file_redirect").filter((node): node is Node => Boolean(node))
}

/**
 * True when the grammar reports redirections this module cannot read structurally. The caller then
 * records one unknown target rather than silently dropping the write.
 */
export function opaqueRedirects(root: Node): boolean {
  if (redirectNodes(root).length > 0) return false
  return root.descendantsOfType("redirection").some((node) => Boolean(node))
}
