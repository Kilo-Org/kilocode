import os from "os"
import path from "path"
import { Effect } from "effect"
import type { Node } from "web-tree-sitter"
import { Shell } from "@opencode-ai/core/shell"
import { ShellAst } from "@/tool/shell"
import { ShellID } from "@/tool/shell/id"
import { unparsed } from "@/kilocode/tool/shell-unparsed"
import { CommandSemantics } from "./command"
import { PathRisk } from "./path"
import type {
  FileEffect,
  NormalizedCommand,
  NormalizedPath,
  NormalizedProcess,
  NormalizedRedirect,
  PathOperand,
} from "./types"

/**
 * Shell normalisation on top of Kilo's existing Tree-sitter scan.
 *
 * Reuses the parser, token extraction and path expansion helpers from `tool/shell.ts` and turns a
 * command line into a structural description: every command inside compound expressions, the
 * executable and argv after unwrapping `sudo`/`env`/`xargs`, static cwd tracking across `cd`,
 * classified path operands and redirect targets, pipelines, substitutions, and recursively parsed
 * `bash -c` / `pwsh -Command` payloads. Anything the grammar could not parse is reported so the
 * rules can refuse to auto-approve it.
 */
export namespace ShellNormalizer {
  export const MAX_DEPTH = 4
  const SCOPES = new Set(["subshell", "command_substitution", "process_substitution", "function_definition"])
  const CD = new Set(["cd", "chdir", "pushd", "popd", "set-location", "push-location", "pop-location"])
  const LOOPS = new Set([
    "for_statement",
    "c_style_for_statement",
    "while_statement",
    "until_statement",
    "if_statement",
    "case_statement",
    "foreach_statement",
    "for_statement_ps",
    "switch_statement",
  ])
  const READ_OPERATORS = new Set(["<", "<&", "<>"])

  export interface Input {
    command: string
    cwd: string
    shell: string
    env: PathRisk.Env
  }

  type Kind = CommandSemantics.Kind

  function kindOf(shell: string): Kind {
    if (Shell.ps(shell)) return "powershell"
    return ShellID.toKind(Shell.name(shell)) === "cmd" ? "cmd" : "bash"
  }

  function walk(node: Node, visit: (node: Node) => void) {
    visit(node)
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) walk(child, visit)
    }
  }

  function ancestor(node: Node, types: Set<string>): Node | undefined {
    let current = node.parent
    while (current) {
      if (types.has(current.type)) return current
      current = current.parent
    }
    return undefined
  }

  function pipeline(node: Node) {
    return ancestor(node, new Set(["pipeline", "pipeline_chain"]))
  }

  /** Commands that precede `node` in the same pipeline, in order. */
  function producers(node: Node, all: Node[]) {
    const pipe = pipeline(node)
    if (!pipe) return []
    return all.filter(
      (item) =>
        item.startIndex < node.startIndex &&
        item.startIndex >= pipe.startIndex &&
        item.endIndex <= pipe.endIndex &&
        pipeline(item)?.id === pipe.id,
    )
  }

  /** True when a `|` precedes the command inside its pipeline (the producer may be a bare expression). */
  function pipedIn(node: Node) {
    const pipe = pipeline(node)
    if (!pipe) return false
    for (let i = 0; i < pipe.childCount; i++) {
      const child = pipe.child(i)
      if (!child) continue
      if (child.startIndex >= node.startIndex) return false
      if (!child.isNamed && (child.type === "|" || child.type === "|&")) return true
    }
    return false
  }

  function redirectOperator(node: Node): string | undefined {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (!child.isNamed && child.type.trim()) return child.type
    }
    return undefined
  }

  function redirectTarget(node: Node): Node | undefined {
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i)
      if (!child) continue
      if (child.isNamed && child.type !== "file_descriptor") return child
    }
    return undefined
  }

  interface State {
    env: PathRisk.Env
    kind: Kind
    shell: string
    depth: number
    /** Symlinks created earlier in the same command line: link absolute path -> target absolute path. */
    links: Map<string, string>
  }

  /** PowerShell expansion resolves `~` through the process home; rebase it onto the session home. */
  function rehome(value: string, state: State) {
    const real = os.homedir()
    if (real === state.env.home || !value.startsWith(real)) return value
    return state.env.home + value.slice(real.length)
  }

  /**
   * PowerShell spellings the FileSystem provider accepts: `` `x `` no-op escapes, provider-qualified
   * paths (`Microsoft.PowerShell.Core\FileSystem::/x`) and `\` as a separator on POSIX. `$env:` values
   * are runtime state (they may be assigned earlier in the same line) and stay dynamic.
   */
  function powershell(value: string): string | undefined {
    if (/\$\{?env:/i.test(value)) return undefined
    const text = value
      .replace(/`([^0abfnrtv`$"\\])/g, "$1")
      .replace(/^(?:[A-Za-z.]+\\)?FileSystem::/i, "")
      .replaceAll("\\", "/")
    return text
  }

  function operandText(
    value: string,
    cwd: string | undefined,
    state: State,
  ): { text: string; glob: boolean } | undefined {
    // `~` and `$HOME` are expanded by PathRisk against the session home, so only quotes are stripped here.
    const ps = state.kind === "powershell" ? powershell(value) : undefined
    if (state.kind === "powershell" && ps === undefined) return undefined
    const raw =
      state.kind === "powershell"
        ? rehome(ShellAst.expand(ps!, cwd ?? "", state.shell), state)
        : rehomeVariable(CommandSemantics.dequote(value), state)
    if (!raw) return undefined
    // Process substitution is a runtime file descriptor, never a static path.
    if (raw.startsWith("<(") || raw.startsWith(">(")) return undefined
    // `~user`, `~+`, `~-` resolve through the shell's environment; only `~` and `~/` are static.
    if (raw.startsWith("~") && raw !== "~" && !raw.startsWith("~/") && !raw.startsWith("~\\")) return undefined
    // `%VAR%` (cmd) and `@splat` (PowerShell) are runtime values.
    if (/%[^%\s]+%/.test(raw) || (state.kind !== "bash" && raw.startsWith("@"))) return undefined
    if (ShellAst.dynamic(raw, state.kind === "powershell")) return undefined
    const text = state.kind === "powershell" ? ShellAst.provider(raw) : raw
    if (!text) return undefined
    const head = ShellAst.prefix(text)
    if (head === undefined) return { text: ".", glob: true }
    return { text: head, glob: head !== text }
  }

  const GLOB_LIMIT = 128

  /**
   * `~/.ss[h]/id_rsa`, `<glob>/../../.ssh/id_rsa`: a wildcard inside a directory segment or followed by
   * `..` hides the real target from the literal prefix. Expand such patterns against the filesystem
   * (dotfiles only when the pattern names them) and classify every match; too many matches or `**`
   * make the operand unknown.
   */
  function expandGlob(text: string, cwd: string | undefined, state: State): string[] | undefined {
    const expanded = text.startsWith("~/") ? state.env.home + text.slice(1) : text === "~" ? state.env.home : text
    const first = expanded.search(/[?*[]/)
    if (first === -1) return [expanded]
    if (expanded.includes("**")) return undefined
    // Expand only up to the first `..` after the wildcard; the remainder is joined lexically so
    // `*/../../.ssh/id_rsa` resolves through every match.
    const cut = expanded.indexOf("/..", first)
    const stem = cut === -1 ? expanded : expanded.slice(0, cut)
    const rest = cut === -1 ? "" : expanded.slice(cut)
    const root = path.isAbsolute(stem) ? path.parse(stem).root : cwd
    if (!root) return []
    const pattern = path.isAbsolute(stem) ? stem.slice(root.length) : stem
    try {
      const out: string[] = []
      for (const match of new Bun.Glob(pattern).scanSync({
        cwd: root,
        dot: /(^|\/)\.[^/]*[?*[]/.test(pattern) || /[?*[][^/]*\./.test(pattern),
        onlyFiles: false,
        followSymlinks: false,
      })) {
        out.push((path.isAbsolute(stem) ? path.join(root, match) : match) + rest)
        if (out.length > GLOB_LIMIT) return undefined
      }
      return out
    } catch {
      return undefined
    }
  }

  /**
   * Static brace expansion (`{a,b}`, `{1..3}`) so every produced target is classified. Nested or
   * unbounded expansions are reported as undefined and treated as dynamic by the caller.
   */
  export function braces(value: string): string[] | undefined {
    const match = value.match(/^([^{}]*)\{([^{}]*)\}(.*)$/)
    if (!match) return value.includes("{") && value.includes("}") ? undefined : [value]
    const body = match[2]!
    const range = body.match(/^(-?\d+)\.\.(-?\d+)$/)
    const items = range
      ? (() => {
          const from = Number(range[1])
          const to = Number(range[2])
          if (Math.abs(to - from) > 64) return undefined
          const step = from <= to ? 1 : -1
          const out: string[] = []
          for (let i = from; step > 0 ? i <= to : i >= to; i += step) out.push(String(i))
          return out
        })()
      : body.includes(",")
        ? body.split(",")
        : [`{${body}}`]
    if (!items) return undefined
    const rest = braces(match[3]!)
    if (!rest) return undefined
    const out = items.flatMap((item) => rest.map((tail) => match[1] + item + tail))
    return out.length > 64 ? undefined : out
  }

  function classifyOne(value: string, cwd: string | undefined, state: State, opts?: { follow?: boolean }) {
    const found = operandText(value, cwd, state)
    if (!found) return PathRisk.unknown(value)
    const direct = PathRisk.classify(found.text, cwd, state.env, opts)
    const linked =
      opts?.follow === false
        ? undefined
        : [...state.links.entries()].find(
            ([link]) => direct.absolute === link || direct.absolute.startsWith(link + path.sep),
          )
    const target = linked ? PathRisk.classify(direct.absolute.replace(linked[0], linked[1]), cwd, state.env) : undefined
    const chosen = target && PathRisk.order(target.relation) > PathRisk.order(direct.relation) ? target : direct
    const labels = [
      ...new Set([...chosen.labels, ...(target?.labels ?? []), ...(found.glob ? (["glob"] as const) : [])]),
    ]
    return { ...chosen, input: value, labels, symlink: chosen.symlink || target !== undefined }
  }

  /**
   * Classify an operand. Brace and glob expansions produce several candidate targets; every one is
   * returned so the rules judge each (a `~/` prefix must not shadow a `.ssh/id_rsa` match).
   */
  function classifyAll(
    value: string,
    cwd: string | undefined,
    state: State,
    opts?: { follow?: boolean },
  ): NormalizedPath[] {
    const expanded = state.kind === "powershell" ? [value] : braces(CommandSemantics.dequote(value))
    if (!expanded) return [PathRisk.unknown(value)]
    const list = expanded.flatMap((item) => {
      // The literal prefix (`~/` for `~/*`) is always classified; real matches are added on top so a
      // wildcard can neither hide a directory segment nor an escaping suffix. Unbounded patterns
      // contribute an unknown target.
      const base = classifyOne(item, cwd, state, opts)
      const text = state.kind === "powershell" ? powershell(item) : CommandSemantics.dequote(item)
      if (text === undefined || ShellAst.dynamic(text, state.kind === "powershell") || !/[?*[]/.test(text))
        return [base]
      const matches = expandGlob(text, cwd, state)
      if (matches === undefined) return [base, PathRisk.unknown(item)]
      return [base, ...matches.map((match) => classifyOne(match, cwd, state, opts))]
    })
    const seen = new Set<string>()
    return list.filter((item) => {
      const key = item.relation + "\0" + item.canonical + "\0" + item.labels.join(",")
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /** Single classification for targets that must be one path (cd, ln). */
  function classify(value: string, cwd: string | undefined, state: State, opts?: { follow?: boolean }) {
    const list = classifyAll(value, cwd, state, opts)
    return list.reduce((acc, item) => (PathRisk.order(item.relation) > PathRisk.order(acc.relation) ? item : acc))
  }

  function scopeOf(node: Node) {
    return ancestor(node, SCOPES)
  }

  /** Relation of a working directory; a temp root itself (`cd /tmp && ...`) counts as temp. */
  function cwdRelationOf(cwd: string, state: State) {
    const own = PathRisk.classify(cwd, cwd, state.env)
    if (own.relation === "external" && PathRisk.classify(path.join(cwd, "x"), cwd, state.env).relation === "temp")
      return "temp" as const
    return own.relation
  }

  /** Scope identity: web-tree-sitter hands out a fresh wrapper per access, so key by node id. */
  function scopeKey(node: Node) {
    return scopeOf(node)?.id ?? -1
  }

  const SKIP = new Set([
    "variable_assignment",
    "file_redirect",
    "heredoc_redirect",
    "herestring_redirect",
    "command_elements",
    "command_argument_sep",
    "redirection",
    "comment",
  ])

  /**
   * Bash operands including expansions and numbers. The permission scanner's `parts()` drops
   * `$VAR`, `$(...)` and numeric words because it only needs literal paths; the security engine
   * must see every operand so a destructive command never appears to have no target.
   */
  function tokens(node: Node, ps: boolean): { type: string; text: string }[] {
    if (ps) return ShellAst.parts(node)
    const out: { type: string; text: string }[] = []
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child || !child.isNamed || SKIP.has(child.type)) continue
      out.push({ type: child.type, text: child.text })
    }
    return out
  }

  /** `$HOME`-prefixed operands are static once the session home is known. */
  function rehomeVariable(value: string, state: State) {
    if (value === "$HOME" || value === "${HOME}") return state.env.home
    const match = value.match(/^\$(?:HOME|\{HOME\})([\\/].*)$/)
    if (match) return state.env.home + match[1]
    return value
  }

  export const normalize = Effect.fn("ShellNormalizer.normalize")(function* (input: Input) {
    const kind = kindOf(input.shell)
    return yield* analyzeText(input.command, kind, input.cwd, {
      env: input.env,
      kind,
      shell: input.shell,
      depth: 0,
      links: new Map(),
    })
  })

  const analyzeText = (
    text: string,
    kind: Kind,
    cwd: string | undefined,
    state: State,
  ): Effect.Effect<NormalizedCommand> =>
    Effect.scoped(
      Effect.gen(function* () {
        const tree = yield* Effect.acquireRelease(ShellAst.parse(text, kind === "powershell"), (tree) =>
          Effect.sync(() => tree.delete()),
        )
        return yield* analyze(tree.rootNode, text, kind, cwd, { ...state, kind })
      }),
    )

  const analyze = (
    root: Node,
    source: string,
    kind: Kind,
    initial: string | undefined,
    state: State,
  ): Effect.Effect<NormalizedCommand> =>
    Effect.gen(function* () {
      const nodes = ShellAst.commands(root)
      // Kilo's scanner fails closed on zero commands so a permission pattern always exists; here the
      // structure itself is the evidence, so only genuine parse errors count as unparsed text.
      const lost = root.hasError ? unparsed(root, nodes.length) : []
      const ps = kind === "powershell"
      const flags = {
        hasPipe: false,
        hasRedirect: false,
        hasSubshell: false,
        hasCommandSubstitution: false,
        hasProcessSubstitution: false,
        hasDynamicExpansion: false,
        hasHeredoc: false,
        hasControlFlow: false,
        hasFunction: false,
        hasBackground: false,
      }
      walk(root, (node) => {
        if (node.type === "pipeline" && node.childCount > 1) flags.hasPipe = true
        if (node.type === "pipeline_chain" && node.childCount > 1) flags.hasPipe = true
        if (node.type === "file_redirect" || node.type === "herestring_redirect" || node.type === "redirection")
          flags.hasRedirect = true
        if (node.type === "subshell" || node.type === "script_block") flags.hasSubshell = true
        if (node.type === "command_substitution" || node.type === "sub_expression") flags.hasCommandSubstitution = true
        if (node.type === "process_substitution") flags.hasProcessSubstitution = true
        if (
          node.type === "simple_expansion" ||
          node.type === "expansion" ||
          node.type === "variable" ||
          node.type === "arithmetic_expansion"
        )
          flags.hasDynamicExpansion = true
        if (node.type === "heredoc_redirect") flags.hasHeredoc = true
        if (LOOPS.has(node.type)) flags.hasControlFlow = true
        if (node.type === "function_definition" || node.type === "function_statement") flags.hasFunction = true
        if (!node.isNamed && node.type === "&") flags.hasBackground = true
      })

      // Static cwd per scope. A `cd` inside a subshell only affects that subshell; a `cd` whose target
      // cannot be resolved makes every later path in that scope unknown, and a `cd` inside a function
      // body poisons the outer scope because the function may run anywhere.
      const cwds = new Map<number, string | undefined>()
      cwds.set(-1, initial)
      let poisoned = false
      const scopeCwd = (node: Node): string | undefined => {
        const scope = scopeOf(node)
        const key = scope?.id ?? -1
        if (poisoned) return undefined
        if (cwds.has(key)) return cwds.get(key)
        const outer: string | undefined = scope ? scopeCwd(scope) : initial
        cwds.set(key, outer)
        return outer
      }
      const setCwd = (node: Node, value: string | undefined) => {
        const scope = scopeOf(node)
        if (scope?.type === "function_definition") {
          poisoned = true
          return
        }
        cwds.set(scope?.id ?? -1, value)
      }

      const commands: NormalizedProcess[] = []
      const positions: { start: number; scope: number; cwd: string | undefined }[] = []
      for (const node of nodes) {
        const parts = tokens(node, ps)
        const words = parts.map((item) => item.text)
        // `NAME=value cmd` prefixes: the grammar attaches them to the command node (they are skipped by
        // tokens()). Keep the static ones so package-provenance rules can see registry overrides.
        const prefixed: Record<string, string> = {}
        const hijack = (() => {
          let found = false
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)
            if (child?.type !== "variable_assignment") continue
            const eq = child.text.indexOf("=")
            if (eq > 0) {
              const value = child.text.slice(eq + 1)
              prefixed[child.text.slice(0, eq)] = ShellAst.dynamic(value, ps) ? "" : CommandSemantics.dequote(value)
            }
            if (
              /^(LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH|BASH_ENV|ENV|PROMPT_COMMAND|GIT_SSH_COMMAND|GIT_SSH|GIT_EXTERNAL_DIFF|GIT_PAGER|PAGER|EDITOR|VISUAL|PERL5OPT|PYTHONSTARTUP|NODE_OPTIONS|RUBYOPT|IFS|PATH|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_DIR|GIT_WORK_TREE)=/.test(
                child.text,
              )
            )
              found = true
          }
          return found
        })()
        const cwd = scopeCwd(node)
        positions.push({ start: node.startIndex, scope: scopeKey(node), cwd })
        const head = parts[0]
        const dynamicName =
          head === undefined ||
          ShellAst.dynamic(head.text, ps) ||
          (ps ? head.type !== "command_name" && head.type !== "command_name_expr" : head.type !== "command_name")
        if (dynamicName || words.length === 0) {
          commands.push({
            executable: undefined,
            argv: words.slice(1),
            cwd,
            operands: [],
            recursive: false,
            force: false,
            dynamic: true,
            stdinTargets: false,
            privileged: false,
            encoded: false,
            network: false,
            piped: producers(node, nodes).length > 0,
            producers: [],
            indirection: "eval",
            metadata: false,
          })
          continue
        }

        const unwrapped = CommandSemantics.unwrap(words, kind)
        const base = unwrapped.chdir
          ? classify(unwrapped.chdir, cwd, state).relation === "unknown"
            ? undefined
            : classify(unwrapped.chdir, cwd, state).absolute
          : cwd
        const executable = unwrapped.executable
        const argv = unwrapped.argv
        const before = producers(node, nodes)
        const piped = before.length > 0 || pipedIn(node)
        const feeders = before.map((item) => {
          const inner = CommandSemantics.unwrap(
            tokens(item, ps).map((part) => part.text),
            kind,
          )
          return { executable: inner.executable ?? "", argv: inner.argv }
        })

        if (executable === undefined) {
          commands.push({
            executable: undefined,
            wrapper: unwrapped.wrapper,
            argv,
            cwd: base,
            operands: [],
            recursive: false,
            force: false,
            dynamic: unwrapped.privileged,
            stdinTargets: unwrapped.stdinTargets,
            privileged: unwrapped.privileged,
            encoded: false,
            network: false,
            piped: before.length > 0,
            producers: feeders.map((item) => item.executable),
            escape: unwrapped.hijack || hijack ? "env" : undefined,
            metadata: unwrapped.wrapper === "env" && argv.length === 0,
          })
          continue
        }

        const alias =
          kind === "bash"
            ? executable
            : (CommandSemantics.PS_ALIASES[executable.toLowerCase()] ?? executable.toLowerCase())
        if (CD.has(alias)) {
          const name = alias
          const target = CommandSemantics.operands(argv)[0]
          if (name === "popd" || name === "pop-location" || target === "-") setCwd(node, undefined)
          else if (target === undefined)
            setCwd(node, name === "pushd" || name === "push-location" ? undefined : state.env.home)
          else {
            const resolved = classify(target, base, state)
            setCwd(node, resolved.relation === "unknown" ? undefined : resolved.absolute)
          }
          commands.push({
            executable: name,
            argv,
            cwd: base,
            operands: [],
            recursive: false,
            force: false,
            dynamic: target !== undefined && classify(target, base, state).relation === "unknown",
            stdinTargets: false,
            privileged: unwrapped.privileged,
            encoded: false,
            network: false,
            piped: false,
            producers: [],
            family: "metadata",
            metadata: true,
          })
          continue
        }

        const spec = CommandSemantics.describe(
          executable,
          kind === "cmd" ? argv.filter((arg) => !/^\/[a-z]+$/i.test(arg)) : argv,
          kind,
        )
        const cwdRelation = base === undefined ? undefined : cwdRelationOf(base, state)
        // A command invoked through a path (`./run.sh`, `~/evil.sh`, `& C:\x.ps1`) executes that file.
        const invoked = CommandSemantics.dequote(head.text).replace(/^&\s*/, "")
        const script =
          /[\\/]/.test(invoked) || invoked.startsWith("~")
            ? [{ value: invoked, effect: "exec" as const, within: false }]
            : []
        const unlink =
          executable === "rm" || executable === "unlink" || executable === "rmdir" || executable === "remove-item"
        const operands: PathOperand[] = [...spec.operands, ...script].flatMap((item) =>
          classifyAll(item.value, base, state, unlink && item.effect === "delete" ? { follow: false } : undefined).map(
            (found) => ({
              path: found,
              effect: item.effect,
              ...(item.within ? { within: true } : {}),
            }),
          ),
        )
        // PowerShell binds pipeline input to -Path: a piped cmdlet without operands acts on unknown targets.
        const bound =
          ps && piped && spec.operands.length === 0 && (spec.effect !== undefined || spec.family === "process-control")
        if (bound && spec.effect === "read") operands.push({ path: PathRisk.unknown("<pipeline>"), effect: "read" })
        const dynamic = operands.some((item) => item.path.relation === "unknown")
        const assignments = { ...prefixed, ...unwrapped.assignments }
        const payload =
          spec.payload && !ShellAst.dynamic(spec.payload.text, spec.payload.kind === "powershell")
            ? spec.payload
            : undefined
        const nested =
          payload && state.depth < MAX_DEPTH
            ? yield* analyzeText(payload.text, payload.kind, base, { ...state, depth: state.depth + 1 })
            : undefined
        // A shell/cmd payload we could not see through (dynamic text, nesting too deep, no static
        // script) is opaque: the rules must not treat it as a benign command.
        const opaque =
          spec.indirection !== undefined &&
          spec.indirection !== "interpreter" &&
          nested === undefined &&
          spec.script === undefined
        const encoded = spec.encoded || feeders.some((item) => CommandSemantics.isDecoder(item.executable, item.argv))

        if (
          executable === "ln" &&
          operands.length > 0 &&
          (argv.includes("-s") || argv.includes("--symbolic") || argv.some((arg) => /^-[a-zA-Z]*s/.test(arg)))
        ) {
          const ops = CommandSemantics.operands(argv)
          const target = ops.at(-2)
          const link = operands.at(-1)?.path
          if (target && link && link.relation !== "unknown") {
            const resolved = classify(target, base, state)
            if (resolved.relation !== "unknown") state.links.set(link.absolute, resolved.absolute)
          }
        }

        commands.push({
          executable:
            kind === "bash"
              ? executable
              : (CommandSemantics.PS_ALIASES[executable.toLowerCase()] ?? executable.toLowerCase()),
          wrapper: unwrapped.wrapper,
          argv,
          cwd: base,
          cwdRelation,
          operands,
          effect: spec.effect,
          recursive: spec.recursive,
          force: spec.force,
          dynamic: dynamic || opaque || spec.dynamic === true,
          stdinTargets: unwrapped.stdinTargets || (bound && spec.effect !== "read"),
          privileged: unwrapped.privileged,
          indirection: spec.indirection,
          nested,
          encoded,
          network: spec.network,
          git: spec.git,
          pkg: spec.pkg,
          piped,
          producers: feeders.map((item) => item.executable),
          family: bound && spec.family === "process-control" ? "system-control" : spec.family,
          // the PowerShell stop-parsing token hides everything after it from the grammar
          escape:
            spec.escape ?? (ps && node.text.includes("--%") ? "--%" : unwrapped.hijack || hijack ? "env" : undefined),
          metadata: spec.metadata && !bound,
          ...(Object.keys(assignments).length > 0 ? { assignments } : {}),
        })
      }

      const redirects: NormalizedRedirect[] = []
      // `positions` and `commands` are parallel (every command node pushes exactly one of each), so the
      // last position at or before a redirect in the same scope names the process it belongs to.
      const commandAt = (index: number, scope: number): number | undefined => {
        for (let i = positions.length - 1; i >= 0; i--) {
          const item = positions[i]!
          if (item.start <= index && item.scope === scope) return i
        }
        return undefined
      }
      const cwdAt = (index: number, scope: number) => {
        const at = commandAt(index, scope)
        if (at !== undefined) return positions[at]!.cwd
        return poisoned ? undefined : initial
      }
      walk(root, (node) => {
        if (node.type === "file_redirect") {
          const operator = redirectOperator(node) ?? ">"
          const target = redirectTarget(node)
          if (!target) return
          if ((operator === ">&" || operator === "<&") && target.type === "number") return
          const effect: NormalizedRedirect["effect"] = READ_OPERATORS.has(operator) ? "read" : "write"
          const text = target.text
          const scope = scopeKey(node)
          const found = classify(text, cwdAt(node.startIndex, scope), state)
          redirects.push({
            operator,
            effect,
            path: found,
            dynamic: found === undefined || found.relation === "unknown",
            append: operator === ">>" || operator === "&>>",
            command: commandAt(node.startIndex, scope),
          })
          return
        }
        if (node.type === "redirection" && ps) {
          const match = node.text.match(/^\s*([0-9*]*)(>>|>|<)\s*(.+)$/s)
          if (!match) return
          const operator = match[2]!
          const text = match[3]!.trim()
          const scope = scopeKey(node)
          const found = classify(text, cwdAt(node.startIndex, scope), state)
          redirects.push({
            operator,
            effect: operator === "<" ? "read" : "write",
            path: found,
            dynamic: found === undefined || found.relation === "unknown",
            append: operator === ">>",
            command: commandAt(node.startIndex, scope),
          })
        }
      })

      const depth = Math.max(state.depth, ...commands.map((item) => (item.nested ? item.nested.depth : state.depth)))
      // .NET static calls, method invocations and type loading run code without a command node.
      const hasExpression =
        ps && /\]::|\.Invoke\(|\.Start\(|Add-Type|New-Object|\[reflection\.|\[System\.Reflection/i.test(source)
      return {
        shell: kind,
        source,
        commands,
        fullyParsed: !root.hasError,
        unparsed: lost,
        redirects,
        ...flags,
        hasSubshell: flags.hasSubshell,
        hasExpression,
        depth,
      } satisfies NormalizedCommand
    })

  /** Flatten a command and every nested payload into one list of processes. */
  export function flatten(command: NormalizedCommand): NormalizedProcess[] {
    return command.commands.flatMap((item) => [item, ...(item.nested ? flatten(item.nested) : [])])
  }

  /** Every command including nested payloads, paired with the command that owns it. */
  export function all(command: NormalizedCommand): NormalizedCommand[] {
    return [command, ...command.commands.flatMap((item) => (item.nested ? all(item.nested) : []))]
  }

  export function effectOf(operand: PathOperand): FileEffect {
    return operand.effect
  }
}
