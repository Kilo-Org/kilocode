import { SystemPart } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect } from "effect"
import SOUL from "./soul.txt"

/**
 * The Kilo persona: who the agent is and how it speaks. It leads the system prompt of every agent request, including
 * agents with their own prompt, and is left out of title requests. It is its own first system part, so the
 * model-specific templates that replace `system[0]` (the upstream prompt optimizer and the Gateway prompt) keep it as
 * long as this plugin runs after them; the host registers it after the config plugins for that reason.
 *
 * `generate` requests (the goal reviewer, cache warming, the `session.generate` API) replay the agent's own system
 * prompt and history, so they get the persona too: without it their first part differs from the agent steps and the
 * provider's prompt cache misses from the first token.
 *
 * The text holds identity and personality only. Working rules (how to plan, when to ask the user, how to edit code)
 * belong to the model templates, the agent prompts and the tool descriptions, which differ per model and agent.
 *
 * Claude Agent provider requests do not get the persona: that provider copies the system parts into its own
 * instructions option before this hook runs, and Claude Code's prompt replaces the first part.
 */
export const KiloSoulPlugin = define({
  id: "kilocode.soul",
  effect: Effect.fn("KiloSoulPlugin")(function* (ctx) {
    const hook = (event: SessionHooks["context"]) =>
      Effect.sync(() => {
        event.system.unshift(SystemPart.make(SOUL.trim()))
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
})
