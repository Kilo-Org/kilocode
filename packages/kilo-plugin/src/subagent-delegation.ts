import { SystemPart } from "@opencode/ai/effect"
import { ClaudeSystemPrompt } from "@opencode/core/plugin/provider/claude-agent/language-model/system-prompt"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option } from "effect"

const upstreamOptIn = /(?:^|\n{2,})# Delegation\n\nDo not spawn subagents unless[^\n]+\.(?=\n|$)/

const guidance = `# Kilo delegation
- Use subagents without waiting for an explicit request when a focused subtask would benefit from parallel work, specialist research, or independent verification. This is Kilo's default even if the built-in model template requires an explicit request. Respect the user's, project's, and agent's specific instructions.
- Prefer background subagents. Give each a clear scope, the context it needs, and an expected result. Start independent work early and continue with non-overlapping work; use a foreground call only if you need the result before you can make progress.
- Handle quick lookups and tightly coupled work directly. Do not duplicate work, assign overlapping edits, or expand the user's scope. Integrate needed results before reporting the task complete.`

export const KiloSubagentDelegationPlugin = define({
  id: "kilocode.subagent-delegation",
  effect: Effect.fn("KiloSubagentDelegationPlugin")(function* (ctx) {
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (!("subagent" in event.tools)) return
        const template = event.system[0]
        // Remove the known conflict without rewriting custom prompts. The explicit precedence above also covers renamed or reworded model templates.
        if (template && upstreamOptIn.test(template.text)) {
          const agent = yield* ctx.agent.get({ agentID: event.agent }).pipe(Effect.option)
          if (Option.isSome(agent) && !agent.value.data.system)
            event.system[0] = { ...template, text: template.text.replace(upstreamOptIn, "") }
        }

        const text =
          "board_post" in event.tools && "board_read" in event.tools
            ? `${guidance}\n- Use the shared board to exchange material findings and blockers while background work is in progress, rather than waiting for final results or polling.`
            : guidance
        // The Claude Agent driver reads the instructions its provider hook already collected, not the final system parts.
        const instructions = event.options[ClaudeSystemPrompt.INSTRUCTIONS_OPTION]
        if (typeof instructions === "string") {
          event.options[ClaudeSystemPrompt.INSTRUCTIONS_OPTION] = [instructions, text].filter(Boolean).join("\n\n")
          return
        }
        event.system.push(SystemPart.make(text))
      }),
    )
  }),
})
