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

const OpenParameters = Schema.Struct({
  path: Schema.optional(
    Schema.String.annotate({
      description: "Optional workspace-local path to the plan file. Omit this to open the current plan.",
    }),
  ),
})

type Input = { readonly path?: string }

// kilo_port(tool:fabed9da976a)
// plan/exit.txt carries the two v1 hunks of tool/plan-exit.txt verbatim (EXIT_DESCRIPTION above):
// kilo_port(unattributed:tool:f6ac0ab8d0f5)
// kilo_port(unattributed:tool:b2cf7d8186a3)
/** The `plan_exit` tool: it locates the plan the planning turn wrote and records it for the follow-up question. */
export function planExit(ctx: Context, store: SessionStore.Interface, data: string) {
  return {
    name: "plan_exit",
    options: { codemode: false, permission: "kilo.plan_exit" },
    description: EXIT_DESCRIPTION,
    input: Parameters,
    output: Schema.String,
    execute: (params: Input, context) =>
      Effect.gen(function* () {
        yield* assert(ctx, "kilo.plan_exit", context)
        const plan = yield* find(ctx, store, data, params, context, "plan_exit")
        return { output: `Plan is ready at ${plan}. Ending planning turn.`, metadata: { plan } }
      }),
  } satisfies Tool.Info<typeof Parameters, typeof Schema.String>
}

/** The `open_plan` tool: the client opens the saved plan as a document for review. */
export function openPlan(ctx: Context, store: SessionStore.Interface, data: string) {
  return {
    name: "open_plan",
    // Code Mode keeps it off the native tool list for agents that can execute, while read-only agents
    // (where Code Mode is disabled) still get it as a direct tool.
    options: { permission: "kilo.open_plan", pinned: true },
    description:
      "Open a saved plan or Markdown document in the document viewer for review.\nCall this after saving a plan, or when the user asks to open a plan file.",
    input: OpenParameters,
    output: Schema.String,
    execute: (params: Input, context) =>
      Effect.gen(function* () {
        yield* assert(ctx, "kilo.open_plan", context)
        const path = yield* find(ctx, store, data, params, context, "open_plan")
        // The client opens a completed part with `open: true` once, in the session it belongs to. The plan
        // plugin also puts the resolved path on a Code Mode `execute` result, where nested metadata is lost.
        return { output: `Opened plan at ${path} for review.`, metadata: { path, open: true } }
      }),
  } satisfies Tool.Info<typeof OpenParameters, typeof Schema.String>
}

function assert(ctx: Context, action: string, context: Tool.Context) {
  return ctx.permission.assert({
    action,
    resources: ["*"],
    sessionID: context.sessionID,
    agent: context.agent,
    source: { type: "tool", messageID: context.messageID, id: context.id },
  })
}

/** The display path of the plan file the session wrote, or a tool error that tells the model what to do. */
const find = Effect.fn(function* (
  ctx: Context,
  store: SessionStore.Interface,
  data: string,
  params: Input,
  context: Tool.Context,
  tool: string,
) {
  const session = yield* store.get(context.sessionID)
  if (!session) return yield* Effect.fail(new Tool.Error({ message: "Session not found" }))
  const messages = yield* store
    .messages({ sessionID: context.sessionID, order: "asc" })
    .pipe(Effect.mapError((error) => new Tool.Error({ message: error.message, error })))
  const resolved = PlanFile.resolve(params.path, ctx.location, data)
  const target = resolved ?? PlanFile.defaultPath(session, ctx.location, data)
  const file = PlanFile.locate(target, messages, ctx.location, data, context.agent)
  if (file) return PlanFile.display(file, ctx.location)
  const hint =
    params.path && !resolved
      ? `The path "${params.path}" cannot be used directly because it is outside the project or it is a directory. `
      : ""
  return yield* Effect.fail(
    new Tool.Error({
      message: `Plan file not found at ${PlanFile.display(target, ctx.location)}. ${hint}Write the plan file first, or call ${tool} with the exact path of the file you wrote.`,
    }),
  )
})
