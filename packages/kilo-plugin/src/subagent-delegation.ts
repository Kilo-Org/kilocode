import { SystemPart } from "@opencode/ai/effect"
import { ClaudeSystemPrompt } from "@opencode/core/plugin/provider/claude-agent/language-model/system-prompt"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect, Option } from "effect"

const upstreamOptIn = /(?:^|\n{2,})# Delegation\n\nDo not spawn subagents unless[^\n]+\.(?=\n|$)/

const guidance = `# Kilo delegation
- Use subagents without waiting for an explicit request when a focused subtask would benefit from parallel work, specialist research, or independent verification. This is Kilo's default even if the built-in model template requires an explicit request. Respect the user's, project's, and agent's specific instructions.
- Prefer background subagents. Give each a clear scope, the context it needs, and an expected result. Start independent work early and continue with non-overlapping work; use a foreground call only if you need the result before you can make progress.
- Handle quick lookups and tightly coupled work directly. Do not duplicate work, assign overlapping edits, or expand the user's scope. Integrate needed results before reporting the task complete.`

export const KiloSubagentDelegationPlugin = define({
  id: "kilocode.subagent-delegation",
  effect: Effect.fn("KiloSubagentDelegationPlugin")(function* (ctx) {
    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const template = event.system[0]
        // All three request kinds render the same model template, so remove the known conflict everywhere to keep
        // their prompts consistent. A custom agent prompt keeps its own wording either way.
        if (template && upstreamOptIn.test(template.text)) {
          const agent = yield* ctx.agent.get({ agentID: event.agent }).pipe(Effect.option)
          if (Option.isSome(agent) && !agent.value.data.system)
            event.system[0] = { ...template, text: template.text.replace(upstreamOptIn, "") }
        }
        // Only offer the policy where delegation can happen; generate and compaction requests carry no tools.
        if (!("subagent" in event.tools)) return
        // The Claude Agent driver reads the instructions its provider hook already collected, not the final system parts.
        const instructions = event.options[ClaudeSystemPrompt.INSTRUCTIONS_OPTION]
        if (typeof instructions === "string") {
          event.options[ClaudeSystemPrompt.INSTRUCTIONS_OPTION] = [instructions, guidance].filter(Boolean).join("\n\n")
          return
        }
        event.system.push(SystemPart.make(guidance))
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
})
