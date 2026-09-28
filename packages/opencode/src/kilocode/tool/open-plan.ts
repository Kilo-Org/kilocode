import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { PlanFile } from "@/kilocode/plan-file"
import { Session } from "@/session/session"
import * as Tool from "@/tool/tool"

export const Parameters = Schema.Struct({
  path: Schema.optional(
    Schema.String.annotate({
      description: "Optional workspace-local path to the plan file. Omit this to open the current plan.",
    }),
  ),
})

type Params = Schema.Schema.Type<typeof Parameters>

export const OpenPlanTool = Tool.define(
  "open_plan",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description:
        "Open the saved plan in the client document viewer so the user can review it. Call this after finalizing the plan and before plan_exit.",
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const resolved = params.path ? PlanFile.resolve(params.path, instance) : undefined
          const messages = yield* session.messages({ sessionID: ctx.sessionID })
          const latest = !params.path ? PlanFile.resolve(PlanFile.latest(messages), instance) : undefined
          const target = resolved ?? latest ?? Session.plan(info, instance)
          const file = yield* Effect.promise(() => PlanFile.locate(target, messages, info, instance, ctx.agent))
          if (!file) {
            const plan = PlanFile.display(target, instance)
            const rejected = params.path && !resolved
            const hint = rejected
              ? `The path "${params.path}" can't be used directly because it is outside the project, or it is a directory. `
              : ""
            return yield* Effect.fail(
              new Error(
                `Plan file not found at ${plan}. ${hint}Write the plan file first, or call open_plan with the exact path of the file you wrote.`,
              ),
            )
          }
          const plan = PlanFile.display(file, instance)
          return {
            title: "Opening plan",
            output: `Opened plan at ${plan} for review.`,
            metadata: { plan, open: true },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
