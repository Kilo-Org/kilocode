import { Effect } from "effect"
import { ConfigMarkdown } from "@/config/markdown"
import { Process } from "@/util/process"
import { SKILL_SHELL_DISABLED, SKILL_SHELL_UNTRUSTED } from "@/kilocode/skills/display"
import type * as Tool from "@/tool/tool"

// A `!`cmd`` placeholder in SKILL.md is replaced by the command's stdout before the
// content reaches the model. Runs only for model-initiated skill loads (not the
// user-initiated `/skill` path), gated by trust (only global/builtin skills), a
// kill-switch (KILO_DISABLE_SKILL_SHELL), and one batch bash ask naming every command
// up front (`skillShell` forces the ask past allow/auto-approve rules; a preceding
// external_directory ask covers out-of-project paths). Substitution runs once; output
// is never re-scanned, so a command can't emit a placeholder a later pass would run.

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
    // Fenced blocks and inline code spans (`` !`cmd` ``) are documentation, not live commands.
    const inert = ranges(opts.content)
    const live = ConfigMarkdown.shell(opts.content).filter((m) => !inert(m.index))
    if (live.length === 0) return opts.content

    // Policy checks before the approval gate; `replace` only touches live placeholders.
    const replace = (value: (command: string) => string) => rewrite(opts.content, inert, value)
    if (opts.disabled) return replace(() => SKILL_SHELL_DISABLED)
    if (!opts.trusted) return replace(() => SKILL_SHELL_UNTRUSTED)

    const shell = opts.shell
    // Dedupe, then cap so a skill can't queue an unbounded number of processes.
    const commands = Array.from(new Set(live.map(([, cmd]) => cmd))).slice(0, MAX_COMMANDS)

    // Decompose each command into sub-command patterns + out-of-project dirs via the shared
    // bash scan, so deny/plan-mode rules and external_directory checks apply per sub-command.
    // Also authorize the verbatim string: decomposition drops cd/chaining metacharacters, so
    // `cd $HOME; cat secret` would otherwise dodge the `*;*`/`*|*`/`*\n*` deny rules.
    const patterns = new Set<string>()
    const dirs = new Set<string>()
    for (const command of commands) {
      patterns.add(command)
      const scan = yield* opts.decompose({ command, cwd: opts.cwd, shell })
      for (const pattern of scan.patterns) patterns.add(pattern)
      for (const dir of scan.dirs) dirs.add(dir)
    }

    // Fail closed: an empty pattern set would auto-approve the ask below. Unreachable since
    // each command adds its own string above, but abort rather than risk silent execution.
    if (patterns.size === 0) return yield* Effect.die(new Error("skill shell produced no authorizable commands"))

    // One up-front bash ask naming every command (metadata.commands is the verbatim list
    // shown, since decomposition can drop/split segments); external_directory asks first if
    // any command leaves the project. `skillShell` forces both asks past allow/YOLO rules.
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

    // Run each command, bounded per-command by ctx.abort/timeout and by an aggregate budget.
    const outputs = new Map<string, string>()
    const deadline = Date.now() + BUDGET_MS
    for (const command of commands) {
      if (Date.now() >= deadline) {
        outputs.set(command, "[skill shell batch time budget exceeded]")
        continue
      }
      outputs.set(command, yield* run(command, shell, opts.cwd, opts.ctx.abort))
    }

    // Mark commands capped out of `commands` rather than silently inlining "".
    return replace((command) => outputs.get(command) ?? LIMIT_NOTE)
  })

  const run = Effect.fn("SkillInject.run")(function* (command: string, shell: string, cwd: string, abort: AbortSignal) {
    const timeout = new AbortController()
    const signal = AbortSignal.any([abort, timeout.signal])
    const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS)
    const result = yield* Effect.promise(() =>
      Process.text([command], { shell, cwd, abort: signal, nothrow: true }).catch(() => undefined),
    ).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timer))))

    // nothrow resolves even on kill, inlining partial stdout; check the signals to mark it.
    if (abort.aborted) return "[skill shell command aborted]"
    if (timeout.signal.aborted) return "[skill shell command timed out]"
    if (!result) return "[skill shell command failed]"
    // Empty stdout on failure would inline ""; surface a marker with any stderr instead.
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

  // Rewrites only live placeholders, once, in the original content — inlined output
  // containing `!`cmd`` stays inert, and documentation examples stay literal text.
  function rewrite(content: string, inert: (index: number) => boolean, value: (command: string) => string) {
    return content.replace(ConfigMarkdown.SHELL_REGEX, (match, command: string, index: number) =>
      inert(index) ? match : value(command),
    )
  }

  // Fenced code block spans (``` or ~~~), sorted and non-overlapping by construction.
  function fenceSpans(content: string): Array<[number, number]> {
    const spans: Array<[number, number]> = []
    const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*$/gm
    let open: { start: number; marker: string } | undefined
    for (const m of content.matchAll(fence)) {
      const marker = m[1]
      // A closing fence uses the same char and is at least as long as the opener (CommonMark).
      if (!open) open = { start: m.index, marker }
      else if (marker[0] === open.marker[0] && marker.length >= open.marker.length) {
        spans.push([open.start, m.index + m[0].length])
        open = undefined
      }
    }
    if (open) spans.push([open.start, content.length]) // unterminated fence runs to EOF
    return spans
  }

  // Also treats inline code spans of 2+ backticks as inert: a single-backtick span can't
  // contain a backtick, so a single-backtick pair nested in a longer run (e.g. `` !`cmd` ``)
  // is always documentation, never a real placeholder.
  function ranges(content: string): (index: number) => boolean {
    const fences = fenceSpans(content)
    const fenced = within(fences)
    const spans: Array<[number, number]> = []
    // Neither a fence nor a blank line can be crossed by an inline span, so pair backtick
    // runs one chunk at a time, split on both.
    for (const chunk of chunks(content, fences)) spans.push(...pairs(chunk))
    return (index: number) => fenced(index) || within(spans)(index)
  }

  // Splits content into the parts outside `cuts` (fenced spans), then further splits each
  // part on blank lines, keeping each chunk's absolute start offset.
  function chunks(content: string, cuts: Array<[number, number]>): Array<{ start: number; text: string }> {
    const out: Array<{ start: number; text: string }> = []
    const push = (from: number, to: number) => {
      const slice = content.slice(from, to)
      const blank = /\n[ \t]*\n/g
      let start = 0
      for (const m of slice.matchAll(blank)) {
        out.push({ start: from + start, text: slice.slice(start, m.index) })
        start = m.index + m[0].length
      }
      out.push({ start: from + start, text: slice.slice(start) })
    }
    let pos = 0
    for (const [s, e] of cuts) {
      if (s > pos) push(pos, s)
      pos = e
    }
    if (pos < content.length) push(pos, content.length)
    return out
  }

  // Pairs backtick runs within one chunk: an opener closes at the *next* run of equal length
  // (CommonMark), and everything between is then consumed rather than rescanned, so spans
  // never nest or overlap and come out in increasing order. An opener with no closer is left
  // as literal text and doesn't affect later pairing.
  function pairs(chunk: { start: number; text: string }): Array<[number, number]> {
    const runs = Array.from(chunk.text.matchAll(/`+/g)).map((m) => ({ start: chunk.start + m.index, len: m[0].length }))
    const next: number[] = new Array(runs.length).fill(-1)
    const last = new Map<number, number>()
    for (let i = runs.length - 1; i >= 0; i--) {
      next[i] = last.get(runs[i].len) ?? -1
      last.set(runs[i].len, i)
    }
    const out: Array<[number, number]> = []
    for (let i = 0; i < runs.length; ) {
      if (runs[i].len < 2 || next[i] < 0) {
        i++
        continue
      }
      const j = next[i]
      out.push([runs[i].start, runs[j].start + runs[j].len])
      i = j + 1
    }
    return out
  }

  // Binary search over a sorted, non-overlapping [start, end) range list.
  function within(spans: Array<[number, number]>): (index: number) => boolean {
    return (index: number) => {
      let lo = 0
      let hi = spans.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const [s, e] = spans[mid]
        if (index < s) hi = mid - 1
        else if (index >= e) lo = mid + 1
        else return true
      }
      return false
    }
  }
}
