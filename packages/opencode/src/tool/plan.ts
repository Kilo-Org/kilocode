import z from "zod"
import path from "path"
import { Effect } from "effect"
import { Tool } from "./tool"
import { Session } from "../session"
import { Instance } from "../project/instance"
import EXIT_DESCRIPTION from "./plan-exit.txt"

// kilocode_change start - simplified plan_exit: readiness signal only, no user prompt
export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: z.object({}),
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(Instance.worktree, Session.plan(info))
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
