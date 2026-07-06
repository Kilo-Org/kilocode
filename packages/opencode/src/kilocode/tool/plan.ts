import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { PlanFile } from "@/kilocode/plan-file"
import EXIT_DESCRIPTION from "@/tool/plan-exit.txt"

export const Parameters = Schema.Struct({
  path: Schema.optional(
    Schema.String.annotate({
      description:
        "Optional workspace-local path to the finalized plan file. Pass this when you saved the plan somewhere other than the provided plan file path.",
    }),
  ),
})

type Params = Schema.Schema.Type<typeof Parameters>

export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          // resolved may be undefined even for a legit path (e.g. the non-git
          // global plans dir), so still fall through to locate()'s recovery.
          const resolved = params.path ? PlanFile.resolve(params.path, instance) : undefined
          const target = resolved ?? Session.plan(info, instance)
          // fetch fresh messages so written() sees a write from this same turn
          const messages = yield* session.messages({ sessionID: ctx.sessionID })
          const file = yield* Effect.promise(() => PlanFile.locate(target, messages, info, instance, ctx.agent))
          if (!file) {
            const plan = PlanFile.display(target, instance)
            const rejected = params.path && !resolved
            const hint = rejected
              ? `The path "${params.path}" you passed can't be used directly — it's outside the project, or it's a directory rather than a file. `
              : ""
            return yield* Effect.fail(
              new Error(
                `Plan file not found at ${plan}. ${hint}Write the plan file first, or call plan_exit with the exact path of the file you wrote.`,
              ),
            )
          }
          const plan = PlanFile.display(file, instance)
          return {
            title: "Planning complete",
            output: `Plan is ready at ${plan}. Ending planning turn.`,
            metadata: { plan },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
