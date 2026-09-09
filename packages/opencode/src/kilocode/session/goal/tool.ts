import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { GoalPolicy } from "./policy"

const Parameters = Schema.Struct({
  status: Schema.Literals(["complete", "blocked"]),
  reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
})

export const GoalReportTool = Tool.define(
  "goal_report",
  Effect.succeed({
    description:
      "Report this active Goal as complete or blocked, with a concrete reason based on your work. This is your report, not independent verification. Only the Goal's root worker may report. Report after finishing work, then give your final response without further actions. The report is saved after the turn finishes; Stop, errors, or a replaced goal can invalidate it. This tool does not grant permission or change scope.",
    parameters: Parameters,
    execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const reason = input.reason.trim()
        if (!reason || ctx.abort.aborted || !GoalPolicy.available(ctx.sessionID, "goal_report"))
          throw new Error("Goal report rejected: no active root Goal execution.")
        yield* ctx.ask({
          permission: "goal_report",
          patterns: [input.status],
          always: ["*"],
          metadata: { status: input.status, reason },
        })
        if (
          !reason ||
          ctx.abort.aborted ||
          !GoalPolicy.report(ctx.sessionID, ctx.messageID, { status: input.status, reason })
        )
          throw new Error("Goal report rejected: no matching active root Goal execution.")
        return {
          title: `Goal reported ${input.status}`,
          output:
            "Report recorded for this turn. Give your final response now. The Goal state is saved only if this execution remains current and finishes without an error or rejected request.",
          metadata: { status: input.status, reason },
        }
      }),
  }),
)
