// kilocode_change - new file
import { Bus } from "@/bus"
import { AgentManagerEvent } from "@/kilocode/agent-manager/event"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"
import DESCRIPTION from "./agent-manager.txt"
import { formatOverview, readOverview } from "./agent-manager-overview"

const Action = Schema.Literals(["start", "overview"])

const Task = Schema.Struct({
  prompt: Schema.optional(Schema.String).annotate({ description: "Initial prompt to send to the new session" }),
  name: Schema.optional(Schema.String).annotate({ description: "Short display name for the Agent Manager card" }),
  branchName: Schema.optional(Schema.String).annotate({ description: "Git branch name seed for worktree mode" }),
}).check(
  Schema.makeFilter((task: { prompt?: string; name?: string; branchName?: string }) =>
    task.prompt?.trim() || task.name?.trim() || task.branchName?.trim()
      ? undefined
      : "Each task must include prompt, name, or branchName",
  ),
)

const ParamsShape = Schema.Struct({
  action: Schema.optional(Action).annotate({
    description:
      "Use overview for a read-only Agent Manager state snapshot, or start to create sessions. Defaults to start.",
  }),
  mode: Schema.optional(Schema.Literals(["worktree", "local"])).annotate({
    description: "Use worktree for isolated git worktrees, or local for same-directory Agent Manager sessions",
  }),
  versions: Schema.optional(Schema.Boolean).annotate({
    description:
      "Set true only when tasks are alternative versions of the same work to compare. Omit or false for independent sessions.",
  }),
  tasks: Schema.optional(Schema.Array(Task).check(Schema.isMinLength(1), Schema.isMaxLength(20))).annotate({
    description: "Agent Manager sessions to start",
  }),
})

export const Params = ParamsShape.check(
  Schema.makeFilter((params: Schema.Schema.Type<typeof ParamsShape>) => {
    if (params.action === "overview") return undefined
    if (params.mode && params.tasks?.length) return undefined
    return "Start action requires mode and at least one task"
  }),
)

export const AgentManagerTool = Tool.define<
  typeof Params,
  { requestID?: string; count?: number; action?: "start" | "overview" },
  Bus.Service,
  "agent_manager"
>(
  "agent_manager",
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          if (params.action === "overview") {
            yield* ctx.ask({
              permission: "agent_manager",
              patterns: ["overview"],
              always: ["overview"],
              metadata: { action: "overview" },
            })
            const overview = yield* Effect.promise(() => readOverview())
            return {
              title: "Agent Manager overview",
              output: formatOverview(overview),
              metadata: { action: "overview" },
            }
          }

          if (!params.mode || !params.tasks) {
            return yield* Effect.die(new Error("Start action requires mode and at least one task"))
          }

          yield* ctx.ask({
            permission: "agent_manager",
            patterns: [params.mode],
            always: [params.mode],
            metadata: { mode: params.mode, count: params.tasks.length },
          })

          const requestID = `am-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          yield* bus.publish(AgentManagerEvent.Start, {
            requestID,
            sessionID: ctx.sessionID,
            mode: params.mode,
            versions: params.versions,
            tasks: params.tasks,
          })

          return {
            title: `Requested ${params.tasks.length} Agent Manager ${params.mode === "worktree" ? "worktree" : "local"} session${params.tasks.length === 1 ? "" : "s"}`,
            output: [
              `Requested ${params.tasks.length} Agent Manager ${params.mode === "worktree" ? "worktree" : "local"} session${params.tasks.length === 1 ? "" : "s"}.`,
              `request_id: ${requestID}`,
              "The VS Code extension will create the sessions asynchronously and show progress in Agent Manager.",
            ].join("\n"),
            metadata: { requestID, count: params.tasks.length },
          }
        }),
    }
  }),
)
