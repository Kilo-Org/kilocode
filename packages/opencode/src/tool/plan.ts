import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import { InstanceState } from "@/effect/instance-state"
import EXIT_DESCRIPTION from "./plan-exit.txt"

export const Parameters = Schema.Struct({})

// kilocode_change start - simplified plan_exit: readiness signal only, no user prompt
export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(instance.worktree, Session.plan(info, instance))
          return {
            title: "Planning complete",
            output: `Plan is ready at ${plan}. Ending planning turn.`,
            metadata: { plan },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
// kilocode_change end
