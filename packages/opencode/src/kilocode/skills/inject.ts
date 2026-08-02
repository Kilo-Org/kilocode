import { Effect } from "effect"
import { ConfigMarkdown } from "@/config/markdown"
import { Process } from "@/util/process"
import { SKILL_SHELL_DISABLED, SKILL_SHELL_UNTRUSTED } from "@/kilocode/skills/display"
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
//      out-of-project directories), then presented once, up front, as a single
//      bash permission prompt naming every command — plus a separate, preceding
//      external_directory prompt if any command touches a directory outside the
//      project. The `skillShell` marker forces both prompts regardless of any
//      allow/auto-approve rule; a deny rule or plan-mode veto on any sub-command
//      still blocks. Approving both runs the batch; rejecting either aborts the load.
//
// Trust and the kill-switch also gate the slash-command path (`/skill`, session/prompt.ts),
// which is user-initiated. Batch approval (control 3) is specific to this model-initiated
// tool path — the slash-command path is not prompted because the user invoked it directly.
//
// Substitution runs exactly once. Command output is inlined as plain text and is
// never re-scanned, so a command cannot emit a `!`cmd`` placeholder that a later
// pass would execute (second-order injection).

// Execution bounds: model-initiated commands must not hang the load, blow up
// context, or overrun the batch.
const TIMEOUT_MS = 2 * 60 * 1000 // per-command
const BUDGET_MS = 5 * 60 * 1000 // aggregate across the batch
const MAX_OUTPUT_BYTES = 32 * 1024
const MAX_COMMANDS = 32
const LIMIT_NOTE = "[skill shell command limit reached]"

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
    // Placeholders inside fenced code blocks are documentation examples, not live commands.
    const fenced = fences(opts.content)
    const live = ConfigMarkdown.shell(opts.content).filter((m) => !fenced(m.index))
    if (live.length === 0) return opts.content

    // Defense-in-depth ordering: policy checks first, approval gate last. `replace` only
    // rewrites live (unfenced) placeholders; fenced ones stay as literal text.
    const replace = (value: (command: string) => string) => rewrite(opts.content, fenced, value)
    if (opts.disabled) return replace(() => SKILL_SHELL_DISABLED)
    if (!opts.trusted) return replace(() => SKILL_SHELL_UNTRUSTED)

    // `shell` is resolved by the caller via Shell.acceptable(cfg.shell), which
    // rejects shells the tree-sitter bash scanner can't parse (fish/nu), keeping
    // the parse used for the permission decision aligned with execution.
    const shell = opts.shell
    // Deduplicate identical commands, then cap the batch so a skill can't queue
    // an unbounded number of processes.
    const commands = Array.from(new Set(live.map(([, cmd]) => cmd))).slice(0, MAX_COMMANDS)

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

    // Up-front approval before any command runs: a bash ask naming every command, preceded
    // by a separate external_directory ask when a sub-command touches a directory outside the
    // project (below). `patterns` are the decomposed sub-commands used for rule matching;
    // `metadata.commands` is the verbatim per-placeholder list the prompt displays, so what is
    // shown is exactly what runs (decomposition drops cd/set-location segments and splits
    // pipelines, which must not hide from the user). `skillShell` forces both prompts over
    // allow/YOLO rules; a deny/veto on any sub-command propagates as a defect and aborts.
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

    // Run each command in the instance directory, bounded per-command by ctx.abort (ESC)
    // and a timeout, and across the batch by an aggregate wall-clock budget, with output
    // truncated so it can't blow up or poison the prompt.
    const outputs = new Map<string, string>()
    const deadline = Date.now() + BUDGET_MS
    for (const command of commands) {
      if (Date.now() >= deadline) {
        outputs.set(command, "[skill shell batch time budget exceeded]")
        continue
      }
      outputs.set(command, yield* run(command, shell, opts.cwd, opts.ctx.abort))
    }

    // A placeholder that was capped out of `commands` isn't in `outputs`; mark it rather
    // than silently inlining an empty string.
    return replace((command) => outputs.get(command) ?? LIMIT_NOTE)
  })

  const run = Effect.fn("SkillInject.run")(function* (command: string, shell: string, cwd: string, abort: AbortSignal) {
    const timeout = new AbortController()
    // A cleared timer bounds the run without leaking a pending 2-minute timeout per command;
    // ESC (ctx.abort) still kills the child via the same combined signal.
    const signal = AbortSignal.any([abort, timeout.signal])
    const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS)
    const result = yield* Effect.promise(() =>
      Process.text([command], { shell, cwd, abort: signal, nothrow: true }).catch(() => undefined),
    ).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timer))))

    // With nothrow the promise resolves even when the child was killed, inlining partial
    // stdout; detect the kill via the signals so an aborted/timed-out command is marked.
    if (abort.aborted) return "[skill shell command aborted]"
    if (timeout.signal.aborted) return "[skill shell command timed out]"
    if (!result) return "[skill shell command failed]"
    // A failing command with empty stdout would inline ""; surface a marker with any stderr.
    if (result.code !== 0 && result.text.length === 0) {
      const err = result.stderr.toString().trim()
      return err ? "[skill shell command failed]\n" + truncate(err) : "[skill shell command failed]"
    }
    return truncate(result.text)
  })

  // Byte-accurate truncation: slice on a Buffer so a multibyte tail can't exceed the cap.
  function truncate(text: string) {
    const buf = Buffer.from(text)
    if (buf.byteLength <= MAX_OUTPUT_BYTES) return text
    return buf.toString("utf8", 0, MAX_OUTPUT_BYTES) + "\n[skill shell output truncated]"
  }

  // Rewrite only live (unfenced) placeholders in the ORIGINAL content, substituting once and
  // never re-scanning the result, so inlined output containing `!`cmd`` stays inert and a
  // fenced documentation example is left as literal text.
  function rewrite(content: string, fenced: (index: number) => boolean, value: (command: string) => string) {
    return content.replace(ConfigMarkdown.SHELL_REGEX, (match, command: string, index: number) =>
      fenced(index) ? match : value(command),
    )
  }

  // Return a predicate that reports whether a character offset falls inside a fenced code
  // block (``` or ~~~), so placeholders in documentation examples are treated as inert.
  function fences(content: string): (index: number) => boolean {
    const ranges: Array<[number, number]> = []
    const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*$/gm
    let open: { start: number; marker: string } | undefined
    for (const m of content.matchAll(fence)) {
      const marker = m[1]
      // CommonMark: a closing fence uses the same char and is at least as long as the opener,
      // so an inner shorter/different fence stays content. Keep the real opener length.
      if (!open) open = { start: m.index, marker }
      else if (marker[0] === open.marker[0] && marker.length >= open.marker.length) {
        ranges.push([open.start, m.index + m[0].length])
        open = undefined
      }
    }
    if (open) ranges.push([open.start, content.length]) // unterminated fence runs to EOF
    return (index: number) => ranges.some(([s, e]) => index >= s && index < e)
  }
}
