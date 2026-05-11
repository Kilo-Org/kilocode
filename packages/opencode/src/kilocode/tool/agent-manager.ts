// kilocode_change - new file
import { Bus } from "@/bus"
import { AgentManagerControlBridge } from "@/kilocode/agent-manager/control"
import { AgentManagerEvent } from "@/kilocode/agent-manager/event"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"
import DESCRIPTION from "./agent-manager.txt"

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

const Action = Schema.Literals([
  "start",
  "prompt",
  "stop",
  "create_section",
  "rename_section",
  "remove_section",
  "move_to_section",
  "ungroup",
])

export const Params = Schema.Struct({
  action: Schema.optional(Action).annotate({
    description:
      "Use start to create sessions, prompt to message an existing session, stop to abort it, or section actions to organize worktree-backed cards.",
  }),
  mode: Schema.optional(Schema.Literals(["worktree", "local"])).annotate({
    description: "Use worktree for isolated git worktrees, or local for same-directory Agent Manager sessions",
  }),
  versions: Schema.optional(Schema.Boolean).annotate({
    description:
      "Set true only when tasks are alternative versions of the same work to compare. Omit or false for independent sessions.",
  }),
  tasks: Schema.optional(Schema.Array(Task).check(Schema.isMinLength(1), Schema.isMaxLength(20))).annotate({
    description: "Agent Manager sessions to start. Required for action=start.",
  }),
  sessionID: Schema.optional(Schema.String).annotate({
    description: "Target Agent Manager session ID for prompt, stop, or move_to_section actions.",
  }),
  prompt: Schema.optional(Schema.String).annotate({
    description: "Message to send to the target session for action=prompt.",
  }),
  worktreeID: Schema.optional(Schema.String).annotate({
    description: "Target worktree/card ID for action=move_to_section.",
  }),
  sectionID: Schema.optional(Schema.String).annotate({
    description: "Target section ID for action=move_to_section. Omit with sectionName to create/resolve by name.",
  }),
  sectionName: Schema.optional(Schema.String).annotate({
    description: "Section name for create_section, or section name to resolve for move_to_section.",
  }),
  newSectionName: Schema.optional(Schema.String).annotate({
    description: "New section name for action=rename_section.",
  }),
  color: Schema.optional(Schema.String).annotate({
    description: "Optional section color for action=create_section.",
  }),
  createIfMissing: Schema.optional(Schema.Boolean).annotate({
    description: "When moving to a named section, create it if missing.",
  }),
}).check(
  Schema.makeFilter((params) => {
    const action = params.action ?? "start"
    if (action === "start") {
      if (!params.mode) return "action=start requires mode"
      if (!params.tasks?.length) return "action=start requires at least one task"
      return undefined
    }
    if (action === "prompt") {
      if (!params.sessionID?.trim()) return "action=prompt requires sessionID"
      if (!params.prompt?.trim()) return "action=prompt requires prompt"
      return undefined
    }
    if (action === "stop") {
      if (!params.sessionID?.trim()) return "action=stop requires sessionID"
      return undefined
    }
    if (action === "create_section") {
      if (!params.sectionName?.trim()) return "action=create_section requires sectionName"
      return undefined
    }
    if (action === "rename_section") {
      if (!params.sectionID?.trim() && !params.sectionName?.trim()) {
        return "action=rename_section requires sectionID or sectionName"
      }
      if (!params.newSectionName?.trim()) return "action=rename_section requires newSectionName"
      return undefined
    }
    if (action === "remove_section") {
      if (!params.sectionID?.trim() && !params.sectionName?.trim()) {
        return "action=remove_section requires sectionID or sectionName"
      }
      return undefined
    }
    if (action === "ungroup") {
      if (!params.worktreeID?.trim() && !params.sessionID?.trim()) {
        return "action=ungroup requires worktreeID or sessionID"
      }
      return undefined
    }
    if (!params.worktreeID?.trim() && !params.sessionID?.trim()) {
      return "action=move_to_section requires worktreeID or sessionID"
    }
    if (!params.sectionID?.trim() && !params.sectionName?.trim()) {
      return "action=move_to_section requires sectionID or sectionName"
    }
    return undefined
  }),
)

const StartParams = Schema.Struct({
  action: Schema.optional(Schema.Literal("start")),
  mode: Schema.Literals(["worktree", "local"]),
  versions: Schema.optional(Schema.Boolean),
  tasks: Schema.Array(Task)
    .check(Schema.isMinLength(1), Schema.isMaxLength(20))
    .annotate({ description: "Agent Manager sessions to start" }),
})

type Params = Schema.Schema.Type<typeof Params>

function action(params: Params) {
  return params.action ?? "start"
}

function start(params: Params): Schema.Schema.Type<typeof StartParams> {
  if (!params.mode || !params.tasks?.length) throw new Error("action=start requires mode and tasks")
  return {
    action: "start",
    mode: params.mode,
    versions: params.versions,
    tasks: params.tasks,
  }
}

function target(params: Params): string {
  if (params.sessionID) return params.sessionID
  if (params.worktreeID) return params.worktreeID
  if (params.sectionName) return params.sectionName
  return params.sectionID ?? action(params)
}

export const AgentManagerTool = Tool.define<
  typeof Params,
  { requestID: string; count: number },
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
          const act = action(params)
          if (act === "start") {
            const req = start(params)
            yield* ctx.ask({
              permission: "agent_manager",
              patterns: [req.mode],
              always: [req.mode],
              metadata: { mode: req.mode, count: req.tasks.length },
            })
          } else {
            yield* ctx.ask({
              permission: "agent_manager",
              patterns: [act, target(params)],
              always: [act],
              metadata: { action: act, target: target(params) },
            })
          }

          const requestID = `am-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          if (act !== "start") {
            const res = yield* AgentManagerControlBridge.request(bus, {
              requestID,
              sessionID: ctx.sessionID,
              action: act,
              targetSessionID: params.sessionID,
              prompt: params.prompt,
              worktreeID: params.worktreeID,
              sectionID: params.sectionID,
              sectionName: params.sectionName,
              newSectionName: params.newSectionName,
              color: params.color,
              createIfMissing: params.createIfMissing,
              abort: ctx.abort,
            })
            return {
              title: `${res.applied ? "Applied" : "Failed"} Agent Manager ${act}`,
              output: AgentManagerControlBridge.format(res),
              metadata: { requestID, count: 1, applied: res.applied },
            }
          }

          const req = start(params)
          yield* bus.publish(AgentManagerEvent.Start, {
            requestID,
            sessionID: ctx.sessionID,
            mode: req.mode,
            versions: req.versions,
            tasks: req.tasks,
          })

          return {
            title: `Requested ${req.tasks.length} Agent Manager ${req.mode === "worktree" ? "worktree" : "local"} session${req.tasks.length === 1 ? "" : "s"}`,
            output: [
              `Requested ${req.tasks.length} Agent Manager ${req.mode === "worktree" ? "worktree" : "local"} session${req.tasks.length === 1 ? "" : "s"}.`,
              `request_id: ${requestID}`,
              "The VS Code extension will create the sessions asynchronously and show progress in Agent Manager.",
            ].join("\n"),
            metadata: { requestID, count: req.tasks.length },
          }
        }),
    }
  }),
)
