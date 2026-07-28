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
//   3. Batch approval: every command in the file is presented once, up front, in
//      a single permission prompt (the `skillShell` metadata marker forces this
//      prompt regardless of any allow/deny/auto-approve rule). Approve runs the
//      whole batch; reject aborts the skill load with nothing run.
//
// Substitution runs exactly once. Command output is inlined as plain text and is
// never re-scanned, so a command cannot emit a `!`cmd`` placeholder that a later
// pass would execute (second-order injection).

const DISABLED_NOTE = "[skill shell execution disabled by policy]"
const UNTRUSTED_NOTE = "[skill shell execution disabled for untrusted skill]"

export namespace SkillInject {
  export type Options = {
    content: string
    trusted: boolean
    disabled: boolean
    ctx: Tool.Context
    spawner: Spawner["Service"]
  }

  export const render = Effect.fn("SkillInject.render")(function* (opts: Options) {
    const matches = ConfigMarkdown.shell(opts.content)
    if (matches.length === 0) return opts.content

    // Defense-in-depth ordering: policy checks first, approval gate last.
    if (opts.disabled) return replace(opts.content, () => DISABLED_NOTE)
    if (!opts.trusted) return replace(opts.content, () => UNTRUSTED_NOTE)

    // Deduplicate identical commands so the batch lists and runs each once.
    const commands = Array.from(new Set(matches.map(([, cmd]) => cmd)))

    // Single up-front approval for the whole batch. `skillShell` forces one
    // prompt even when rules would allow or deny; a reject/deny propagates as a
    // defect and aborts the skill load without running anything.
    yield* opts.ctx.ask({
      permission: "bash",
      patterns: commands,
      always: [],
      metadata: { skillShell: true },
    })

    const shell = Shell.preferred()
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
