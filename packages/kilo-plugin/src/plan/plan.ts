export * as PlanExit from "./plan"

// Core internal with no public surface: the durable session store the tool reads the turn from.
import type { SessionStore } from "@opencode/core/session/store"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import EXIT_DESCRIPTION from "./exit.txt"
import { PlanFile } from "./plan-file"

const Parameters = Schema.Struct({
  path: Schema.optional(
    Schema.String.annotate({
      description:
        "Optional workspace-local path to the finalized plan file. Pass this when you saved the plan somewhere other than the provided plan file path.",
    }),
  ),
})

type Parameters = typeof Parameters.Type

/** The `plan_exit` tool: it locates the plan the planning turn wrote and records it for the follow-up question. */
export function planExit(
  ctx: Context,
  store: SessionStore.Interface,
  roots: readonly string[] = [],
): Tool.Info<typeof Parameters, typeof Schema.String> {
  return {
    name: "plan_exit",
    options: { codemode: false, permission: "kilo.plan_exit" },
    description: EXIT_DESCRIPTION,
    input: Parameters,
    output: Schema.String,
    execute: (params: Parameters, context) =>
      Effect.gen(function* () {
        yield* ctx.permission.assert({
          action: "kilo.plan_exit",
          resources: ["*"],
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
        })
        const session = yield* store.get(context.sessionID)
        if (!session) return yield* Effect.fail(new Tool.Error({ message: "Session not found" }))

        const messages = yield* store
          .messages({ sessionID: context.sessionID, order: "asc" })
          .pipe(Effect.mapError((error) => new Tool.Error({ message: error.message, error })))
        const resolved = PlanFile.resolve(params.path, ctx.location, ctx.location.directory, roots)
        const target = resolved ?? PlanFile.defaultPath(session, ctx.location)
        const file = PlanFile.locate(target, messages, ctx.location, context.agent, roots)
        if (!file) {
          const plan = PlanFile.display(target, ctx.location)
          const hint =
            params.path && !resolved
              ? `The path "${params.path}" cannot be used directly because it is outside the project or it is a directory. `
              : ""
          return yield* Effect.fail(
            new Tool.Error({
              message: `Plan file not found at ${plan}. ${hint}Write the plan file first, or call plan_exit with the exact path of the file you wrote.`,
            }),
          )
        }
        const plan = PlanFile.display(file, ctx.location)
        return {
          output: `Plan is ready at ${plan}. Ending planning turn.`,
          metadata: { plan },
        }
      }),
  }
}
