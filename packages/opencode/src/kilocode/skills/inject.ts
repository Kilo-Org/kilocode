import { Effect } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import type { ChildProcessSpawner as Spawner } from "effect/unstable/process/ChildProcessSpawner"
import { ConfigMarkdown } from "@/config/markdown"
import { CommandTimeout } from "@/kilocode/command-timeout"
import { Shell } from "@opencode-ai/core/shell"
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
    ctx: Tool.Context
    spawner: Spawner["Service"]
    decompose: Decompose
  }

  export const render = Effect.fn("SkillInject.render")(function* (opts: Options) {
    const matches = ConfigMarkdown.shell(opts.content)
    if (matches.length === 0) return opts.content

    // Defense-in-depth ordering: policy checks first, approval gate last.
    if (opts.disabled) return replace(opts.content, () => DISABLED_NOTE)
    if (!opts.trusted) return replace(opts.content, () => UNTRUSTED_NOTE)

    const shell = Shell.preferred()
    // Deduplicate identical commands so the batch lists and runs each once.
    const commands = Array.from(new Set(matches.map(([, cmd]) => cmd)))

    // Decompose each command into sub-command patterns + out-of-project dir globs
    // via the shared bash scan, so plan-mode denies and external_directory checks
    // apply per sub-command instead of matching the raw string as one glob.
    const patterns = new Set<string>()
    const dirs = new Set<string>()
    for (const command of commands) {
      const scan = yield* opts.decompose({ command, cwd: opts.cwd, shell })
      for (const pattern of scan.patterns) patterns.add(pattern)
      for (const dir of scan.dirs) dirs.add(dir)
    }

    // Single up-front approval. Out-of-project directories are asked first, then
    // the decomposed sub-commands. `skillShell` forces the prompt over allow/YOLO
    // rules; a deny/veto on any sub-command propagates as a defect and aborts.
    if (dirs.size > 0) {
      yield* opts.ctx.ask({
        permission: "external_directory",
        patterns: Array.from(dirs),
        always: [],
        metadata: { skillShell: true },
      })
    }
    yield* opts.ctx.ask({
      permission: "bash",
      patterns: Array.from(patterns),
      always: [],
      metadata: { skillShell: true },
    })

    const outputs = new Map<string, string>()
    for (const command of commands) {
      outputs.set(
        command,
        yield* CommandTimeout.text(command, shell).pipe(Effect.provideService(ChildProcessSpawner, opts.spawner)),
      )
    }

    return replace(opts.content, (command) => outputs.get(command) ?? "")
  })

  // Replace only the exact matches found in the ORIGINAL content. Never re-scan
  // the result, so inlined output containing `!`cmd`` stays inert.
  function replace(content: string, value: (command: string) => string) {
    return content.replace(ConfigMarkdown.SHELL_REGEX, (_, command: string) => value(command))
  }
}
