import { Effect } from "effect"
import { ConfigMarkdown } from "@/config/markdown"
import { Process } from "@/util/process"
import type * as Tool from "@/tool/tool"

// Shell injection for skill bodies mirrors Claude's "dynamic context injection":
// a `!`cmd`` placeholder in SKILL.md is replaced by the command's stdout before
// the content reaches the model. Unlike the slash-command path, this runs for
// model-initiated skill loads, so it is gated on three independent controls:
//
//   1. Trust: only skills from trusted sources (global ~/.claude, ~/.agents,
//      KILO_CONFIG_DIR, and builtins) may execute. Untrusted project/downloaded
//      skills never spawn a process.
//   2. Kill-switch: `disabled` (KILO_DISABLE_SKILL_SHELL) turns injection off
//      entirely, matching Claude's disableSkillShellExecution.
//   3. Batch approval: every command in the file is decomposed with the same
//      tree-sitter scan the bash tool uses (per sub-command patterns plus any
//      out-of-project directories), then presented once, up front, in a single
//      permission prompt. The `skillShell` marker forces this prompt regardless
//      of any allow/auto-approve rule; a deny rule or plan-mode veto on any
//      sub-command still blocks. Approve runs the batch; reject aborts the load.
//
// Substitution runs exactly once. Command output is inlined as plain text and is
// never re-scanned, so a command cannot emit a `!`cmd`` placeholder that a later
// pass would execute (second-order injection).

const DISABLED_NOTE = "[skill shell execution disabled by policy]"
const UNTRUSTED_NOTE = "[skill shell execution disabled for untrusted skill]"

// Execution bounds: model-initiated commands must not hang the load, blow up
// context, or overrun the batch.
const TIMEOUT_MS = 2 * 60 * 1000
const MAX_OUTPUT_BYTES = 32 * 1024
const MAX_COMMANDS = 32

export namespace SkillInject {
  export type Decompose = (input: {
    command: string
    cwd: string
    shell: string
  }) => Effect.Effect<{ patterns: string[]; dirs: string[] }>

  export type Options = {
    content: string
    trusted: boolean
    disabled: boolean
    cwd: string
    skill: string
    shell: string
    ctx: Tool.Context
    decompose: Decompose
  }

  export const render = Effect.fn("SkillInject.render")(function* (opts: Options) {
    const matches = ConfigMarkdown.shell(opts.content)
    if (matches.length === 0) return opts.content

    // Defense-in-depth ordering: policy checks first, approval gate last.
    if (opts.disabled) return replace(opts.content, () => DISABLED_NOTE)
    if (!opts.trusted) return replace(opts.content, () => UNTRUSTED_NOTE)

    // `shell` is resolved by the caller via Shell.acceptable(cfg.shell), which
    // rejects shells the tree-sitter bash scanner can't parse (fish/nu), keeping
    // the parse used for the permission decision aligned with execution.
    const shell = opts.shell
    // Deduplicate identical commands, then cap the batch so a skill can't queue
    // an unbounded number of processes.
    const commands = Array.from(new Set(matches.map(([, cmd]) => cmd))).slice(0, MAX_COMMANDS)

    // Decompose each command into sub-command patterns + out-of-project dir globs
    // via the shared bash scan, so plan-mode denies and external_directory checks
    // apply per sub-command instead of matching the raw string as one glob. Also
    // authorize the verbatim command: decomposition drops cd/set-location segments
    // and strips chaining metacharacters, so a payload like `cd $HOME; cat secret`
    // would otherwise slip past the metachar deny rules (`*;*`, `*|*`, `*\n*`) and
    // hide the escape. Keeping the raw string as a pattern makes those rules fire.
    const patterns = new Set<string>()
    const dirs = new Set<string>()
    for (const command of commands) {
      patterns.add(command)
      const scan = yield* opts.decompose({ command, cwd: opts.cwd, shell })
      for (const pattern of scan.patterns) patterns.add(pattern)
      for (const dir of scan.dirs) dirs.add(dir)
    }

    // Fail closed: an empty pattern set would make the bash ask below auto-approve
    // (Permission.ask iterates patterns, so forceAsk/veto never run for an empty
    // list). Each command contributes its verbatim string above, so this is
    // unreachable — but abort rather than risk a silent, unprompted execution.
    if (patterns.size === 0) return yield* Effect.die(new Error("skill shell produced no authorizable commands"))

    // Single up-front approval. `patterns` are the decomposed sub-commands used for
    // rule matching; `metadata.commands` is the verbatim per-placeholder list the
    // prompt displays, so what is shown is exactly what runs (decomposition drops
    // cd/set-location segments and splits pipelines, which must not hide from the
    // user). `skillShell` forces the prompt over allow/YOLO rules; a deny/veto on
    // any sub-command propagates as a defect and aborts.
    const metadata = { skillShell: true, skill: opts.skill, commands }
    if (dirs.size > 0) {
      yield* opts.ctx.ask({
        permission: "external_directory",
        patterns: Array.from(dirs),
        always: [],
        metadata,
      })
    }
    yield* opts.ctx.ask({
      permission: "bash",
      patterns: Array.from(patterns),
      always: [],
      metadata,
    })

    // Run each command in the instance directory, bounded by ctx.abort (ESC) and a
    // timeout, with output truncated so it can't blow up or poison the prompt.
    const outputs = new Map<string, string>()
    for (const command of commands) {
      outputs.set(command, yield* run(command, shell, opts.cwd, opts.ctx.abort))
    }

    return replace(opts.content, (command) => outputs.get(command) ?? "")
  })

  const run = Effect.fn("SkillInject.run")(function* (command: string, shell: string, cwd: string, abort: AbortSignal) {
    const result = yield* Effect.promise(async () => {
      // A cleared timer bounds the run without leaking a pending 2-minute timeout
      // per command; ESC (ctx.abort) still kills the child via the same signal.
      const controller = new AbortController()
      const signal = AbortSignal.any([abort, controller.signal])
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        return await Process.text([command], { shell, cwd, abort: signal, nothrow: true }).catch(() => undefined)
      } finally {
        clearTimeout(timer)
      }
    })
    if (!result) return abort.aborted ? "[skill shell command aborted]" : "[skill shell command timed out]"
    return truncate(result.text)
  })

  function truncate(text: string) {
    if (Buffer.byteLength(text) <= MAX_OUTPUT_BYTES) return text
    return text.slice(0, MAX_OUTPUT_BYTES) + "\n[skill shell output truncated]"
  }

  // Replace only the exact matches found in the ORIGINAL content. Never re-scan
  // the result, so inlined output containing `!`cmd`` stays inert.
  function replace(content: string, value: (command: string) => string) {
    return content.replace(ConfigMarkdown.SHELL_REGEX, (_, command: string) => value(command))
  }
}
