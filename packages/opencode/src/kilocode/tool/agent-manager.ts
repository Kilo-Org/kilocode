import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { AgentManagerEvent, type AgentManagerTask } from "@/kilocode/agent-manager/event"
import { AgentManager, HostError } from "@/kilocode/agent-manager/service"
import type { Result } from "@/kilocode/agent-manager/protocol"
import * as SandboxInheritance from "@/kilocode/sandbox/inheritance"
import { KiloSessionMessageOrder } from "@/kilocode/session/message-order"
import { Provider } from "@/provider/provider"
import { SessionID } from "@/session/schema"
import * as ToolJsonSchema from "@/tool/json-schema"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"
import { selectModel } from "./model-selection"
import DESCRIPTION from "./agent-manager.txt"

const Task = Schema.Struct({
  prompt: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Initial prompt to send to the new session",
  }),
  name: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Short display name for the Agent Manager card",
  }),
  branchName: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Git branch name seed for worktree mode",
  }),
  model: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description:
      "Optional model override from agent_manager_models (e.g. 'Claude Opus 4.1'). Omit unless the user requests a different model. Agent Manager otherwise inherits the current turn's model. A qualified provider/model ID is also accepted to force a specific provider.",
  }),
  provider: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description:
      "Optional provider ID to constrain model resolution (e.g. 'anthropic'). Use with model to select a model from a specific provider; omit to use the current-turn provider preference.",
  }),
  variant: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description:
      "Optional reasoning variant override from agent_manager_models. Specify it without model to override the inherited model's variant. Omit both to inherit the current turn's selection.",
  }),
}).check(
  Schema.makeFilter((task) =>
    task.prompt?.trim() || task.name?.trim() || task.branchName?.trim()
      ? undefined
      : "Each task must include prompt, name, or branchName",
  ),
  Schema.makeFilter((task) =>
    task.model?.trim() && !task.prompt?.trim() ? "A task model requires an initial prompt" : undefined,
  ),
  Schema.makeFilter((task) =>
    task.provider?.trim() && !task.model?.trim() ? "A task provider requires a model" : undefined,
  ),
  Schema.makeFilter((task) =>
    task.variant?.trim() && !task.prompt?.trim() ? "A task variant requires an initial prompt" : undefined,
  ),
)

const StartParams = Schema.Struct({
  mode: Schema.Literals(["worktree", "local"]).annotate({
    description: "Use worktree for isolated git worktrees, or local for same-directory Agent Manager sessions",
  }),
  versions: Schema.optional(Schema.NullOr(Schema.Boolean)).annotate({
    description:
      "Set true only when tasks are alternative versions of the same work to compare. Omit or false for independent sessions.",
  }),
  tasks: Schema.Array(Task)
    .check(Schema.isMinLength(1), Schema.isMaxLength(20))
    .annotate({ description: "Agent Manager sessions to start" }),
})

const ListParams = Schema.Struct({
  action: Schema.Literal("list").annotate({
    description:
      "Read the current Agent Manager sections, worktrees, and sessions before any assignment. This is the source of truth for section and session IDs.",
  }),
  filter: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        sectionIDs: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(100))),
        states: Schema.optional(
          Schema.Array(Schema.Literals(["idle", "busy", "retry", "offline", "waiting"])).check(Schema.isMaxLength(5)),
        ),
      }),
    ),
  ).annotate({
    description: "Optional list filter. Omit this for an unfiltered overview when discovering assignments.",
  }),
})

const PromptParams = Schema.Struct({
  action: Schema.Literal("prompt"),
  sessionID: SessionID,
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)).check(
    Schema.makeFilter((value) => (value.trim() ? undefined : "Prompt must not be empty")),
  ),
})

const StopParams = Schema.Struct({
  action: Schema.Literal("stop"),
  sessionID: SessionID,
})

const MoveParams = Schema.Struct({
  action: Schema.Literal("move").annotate({
    description: "Move exactly one managed worktree by targeting one of its session IDs returned by action=list.",
  }),
  sessionID: SessionID.annotate({
    description: "Session ID returned by action=list. Do not use a worktree name, branch, or section name.",
  }),
  sectionID: Schema.NullOr(Schema.String).annotate({
    description: "Section ID returned by action=list. Use null to unassign the worktree from its current section.",
  }),
})

const AnswerParams = Schema.Struct({
  action: Schema.Literal("answer").annotate({
    description: "Resolve the pending question that blocks exactly one managed session.",
  }),
  sessionID: SessionID,
  questionID: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description:
      "Pending question ID, learned from a failed prompt or an earlier answer error. Omit only when exactly one question is pending.",
  }),
  answers: Schema.Array(
    Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))).check(Schema.isMaxLength(20)),
  )
    .check(Schema.isMinLength(1), Schema.isMaxLength(20))
    .annotate({
      description:
        "One array of selected option labels per question of the request, in order. Labels must match the advertised options.",
    }),
})

export const Params = Schema.Union([
  Schema.Struct({
    ...StartParams.fields,
    tasks: Schema.Union([StartParams.fields.tasks, Schema.fromJsonString(StartParams.fields.tasks)]),
  }),
  ListParams,
  PromptParams,
  StopParams,
  MoveParams,
  AnswerParams,
])

// Anthropic rejects a top-level anyOf/oneOf/allOf, so the advertised schema has to
// stay one flat object while Params keeps the real per-operation validation. That
// flattening means providers with strict structured outputs (the OpenAI Responses
// API) must supply a value for every property, so every field is nullable: null is
// how a model says "this field is not part of the operation I picked". Without it
// the model is forced to invent a value, and an invented action wins over mode and
// tasks, turning a start request into a list.
const WireParams = Schema.Struct({
  mode: Schema.optional(Schema.NullOr(StartParams.fields.mode)).annotate({
    description:
      "Start sessions only. Use worktree for isolated git worktrees, or local for same-directory Agent Manager sessions. Send null whenever action is set.",
  }),
  versions: Schema.optional(Schema.NullOr(Schema.Boolean)).annotate({
    description:
      "Set true only when tasks are alternative versions of the same work to compare. Omit or false for independent sessions.",
  }),
  tasks: Schema.optional(Schema.NullOr(StartParams.fields.tasks)).annotate({
    description: "Start sessions only. Agent Manager sessions to start. Send null whenever action is set.",
  }),
  action: Schema.optional(
    Schema.NullOr(Schema.Literals(["list", "prompt", "stop", "move", "answer"])).annotate({
      description:
        "Use list first to discover IDs and assignments. Use move only after list, once per worktree. Never edit .kilo/agent-manager.json for these operations. Send null when starting sessions with mode and tasks, otherwise the action is used instead of the start request.",
    }),
  ),
  filter: ListParams.fields.filter,
  sessionID: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description:
      "For prompt, stop, move, and answer: a session ID returned by action=list (IDs start with ses_). Send null for every other operation.",
  }),
  prompt: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description:
      "For prompt: the instruction to send to that session. Start requests use tasks[].prompt instead, so send null.",
  }),
  sectionID: Schema.optional(MoveParams.fields.sectionID),
  questionID: AnswerParams.fields.questionID,
  answers: Schema.optional(Schema.NullOr(AnswerParams.fields.answers)),
})

type Input = Schema.Schema.Type<typeof Task>
type Selected = { task?: AgentManagerTask; error?: string }
type Source = { model: NonNullable<AgentManagerTask["model"]>; variant?: string }

function abort(signal: AbortSignal) {
  return Effect.callback<never, HostError>((resume) => {
    const err = () => new HostError({ code: "cancelled", detail: "The Agent Manager tool call was cancelled" })
    if (signal.aborted) return resume(Effect.fail(err()))
    const handler = () => resume(Effect.fail(err()))
    signal.addEventListener("abort", handler, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", handler))
  })
}

function run(effect: Effect.Effect<Result, HostError>, signal: AbortSignal) {
  return effect.pipe(Effect.raceFirst(abort(signal)), Effect.orDie)
}

function select(
  task: Input,
  providers: Record<string, Provider.Info>,
  preferred: string | undefined,
  source: Source | undefined,
  index: number,
): Selected {
  const base = {
    ...(task.prompt != null ? { prompt: task.prompt } : {}),
    ...(task.name != null ? { name: task.name } : {}),
    ...(task.branchName != null ? { branchName: task.branchName } : {}),
  }
  if (!task.model?.trim() && !task.variant?.trim()) {
    return { task: task.prompt?.trim() && source ? { ...base, ...source } : base }
  }
  const selected = selectModel(task, providers, source, preferred)
  if ("error" in selected) return { error: `Task ${index + 1} ${selected.error}` }
  return { task: { ...base, ...selected } }
}

export const AgentManagerTool = Tool.define<
  typeof Params,
  {
    action: "start" | "list" | "prompt" | "stop" | "move" | "answer"
    requestID?: string
    count?: number
    sessionID?: string
    questionID?: string
  },
  AgentManager.Service | Bus.Service | Provider.Service,
  "agent_manager"
>(
  "agent_manager",
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const host = yield* AgentManager.Service
    const provider = yield* Provider.Service
    const wire = ToolJsonSchema.fromSchema(WireParams)
    const section = wire.properties?.sectionID
    if (section && typeof section === "object" && wire.properties) {
      wire.properties.sectionID = {
        anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
        description: "Section ID returned by action=list. Use null to unassign the worktree from its current section.",
      }
    }
    return {
      description: DESCRIPTION,
      parameters: Params,
      jsonSchema: wire,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          if ("action" in params) {
            if (params.action === "list") {
              yield* ctx.ask({
                permission: "agent_manager",
                patterns: ["overview"],
                always: ["overview"],
                metadata: { action: "list" },
              })
              const result = yield* run(
                host.request({ operation: "overview", sessionID: ctx.sessionID, filter: params.filter ?? undefined }),
                ctx.abort,
              )
              if (result.operation !== "overview")
                return yield* Effect.die(new Error("Agent Manager host returned the wrong result type"))
              const count =
                (result.overview.local?.sessions.length ?? 0) +
                result.overview.ungrouped.length +
                result.overview.sections.reduce((sum, section) => sum + section.worktrees.length, 0)
              return {
                title: "Agent Manager overview",
                output: JSON.stringify(
                  {
                    instructions:
                      "This overview is the source of truth. Use sections[].id as sectionID and sessions[].id/session.id as sessionID for action=move. Do not edit .kilo/agent-manager.json.",
                    ...result.overview,
                  },
                  null,
                  2,
                ),
                metadata: { action: "list", count },
              }
            }
            if (params.action === "prompt") {
              const prompt = params.prompt.trim()
              yield* ctx.ask({
                permission: "agent_manager",
                patterns: ["prompt"],
                always: ["prompt"],
                metadata: {
                  action: "prompt",
                  sessionID: params.sessionID,
                  description: `Send a prompt to Agent Manager session ${params.sessionID}:\n\n${prompt}`,
                },
              })
              const result = yield* run(
                host.request({
                  operation: "prompt",
                  sessionID: ctx.sessionID,
                  targetSessionID: params.sessionID,
                  prompt,
                }),
                ctx.abort,
              )
              if (result.operation !== "prompt")
                return yield* Effect.die(new Error("Agent Manager host returned the wrong result type"))
              return {
                title: "Prompt accepted",
                output: `Agent Manager session ${result.sessionID} accepted the prompt. If the session is busy, the prompt is queued behind active work. This does not wait for completion.`,
                metadata: { action: "prompt", sessionID: result.sessionID },
              }
            }
            if (params.action === "stop") {
              yield* ctx.ask({
                permission: "agent_manager",
                patterns: ["stop"],
                always: ["stop"],
                metadata: { action: "stop", sessionID: params.sessionID },
              })
              const result = yield* run(
                host.request({
                  operation: "stop",
                  sessionID: ctx.sessionID,
                  targetSessionID: params.sessionID,
                }),
                ctx.abort,
              )
              if (result.operation !== "stop")
                return yield* Effect.die(new Error("Agent Manager host returned the wrong result type"))
              return {
                title: "Session stopped",
                output: `Stopped Agent Manager session ${result.sessionID} and removed it from Agent Manager.`,
                metadata: { action: "stop", sessionID: result.sessionID },
              }
            }
            if (params.action === "answer") {
              yield* ctx.ask({
                permission: "agent_manager",
                patterns: ["answer"],
                always: ["answer"],
                metadata: { action: "answer", sessionID: params.sessionID },
              })
              const result = yield* run(
                host.request({
                  operation: "answer",
                  sessionID: ctx.sessionID,
                  targetSessionID: params.sessionID,
                  ...(params.questionID?.trim() ? { questionID: params.questionID.trim() } : {}),
                  answers: params.answers,
                }),
                ctx.abort,
              )
              if (result.operation !== "answer")
                return yield* Effect.die(new Error("Agent Manager host returned the wrong result type"))
              return {
                title: "Question answered",
                output: `Answered Agent Manager question ${result.questionID} for session ${result.sessionID}. The session resumes with those answers.`,
                metadata: { action: "answer", sessionID: result.sessionID, questionID: result.questionID },
              }
            }
            yield* ctx.ask({
              permission: "agent_manager",
              patterns: ["move"],
              always: ["move"],
              metadata: { action: "move", sessionID: params.sessionID, sectionID: params.sectionID },
            })
            const result = yield* run(
              host.request({
                operation: "move",
                sessionID: ctx.sessionID,
                targetSessionID: params.sessionID,
                sectionID: params.sectionID,
              }),
              ctx.abort,
            )
            if (result.operation !== "move")
              return yield* Effect.die(new Error("Agent Manager host returned the wrong result type"))
            return {
              title: "Session moved",
              output: `Moved Agent Manager session ${result.sessionID} to ${result.sectionID ?? "Ungrouped"}.`,
              metadata: { action: "move", sessionID: result.sessionID, sectionID: result.sectionID },
            }
          }

          const msg = KiloSessionMessageOrder.latest(ctx.messages).user
          const source: Source | undefined = msg
            ? {
                model: {
                  providerID: msg.model.providerID,
                  modelID: msg.model.modelID,
                },
                ...(msg.model.variant ? { variant: msg.model.variant } : {}),
              }
            : undefined
          const need = params.tasks.some((task) => task.model?.trim() || task.provider?.trim() || task.variant?.trim())
          const providers = need ? yield* provider.list() : undefined
          const preferred = need
            ? (source?.model.providerID ??
              (yield* provider.defaultModel().pipe(
                Effect.map((model) => model.providerID as string),
                Effect.catch(() => Effect.succeed(undefined)),
              )))
            : undefined
          const selected = params.tasks.map((task, index) => select(task, providers ?? {}, preferred, source, index))
          const errors = selected.flatMap((item) => (item.error ? [item.error] : []))
          if (errors.length > 0) {
            return {
              title: "Invalid Agent Manager model selection",
              output: [
                "No Agent Manager sessions were requested.",
                ...errors,
                "Use agent_manager_models to find available model names and reasoning variants.",
              ].join("\n"),
              metadata: { action: "start", count: 0 },
            }
          }
          const tasks = selected.flatMap((item) => (item.task ? [item.task] : []))

          yield* ctx.ask({
            permission: "agent_manager",
            patterns: [params.mode],
            always: [params.mode],
            metadata: { mode: params.mode, count: tasks.length },
          })

          const requestID = `am-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const directory = yield* InstanceState.directory
          const sandboxInheritanceToken = SandboxInheritance.issue({
            sessionID: ctx.sessionID,
            directory,
            count: params.tasks.length,
          })
          yield* bus.publish(AgentManagerEvent.Start, {
            requestID,
            sessionID: ctx.sessionID,
            sandboxInheritanceToken,
            mode: params.mode,
            ...(params.versions != null ? { versions: params.versions } : {}),
            tasks,
          })

          // Echo how each named model resolved (provider + variant) so the agent
          // and the user can confirm the resolution without opening the session.
          const resolved = tasks.flatMap((task, index) => {
            if (!params.tasks[index]?.model?.trim() || !task.model) return []
            const name = providers?.[task.model.providerID]?.models[task.model.modelID]?.name
            const label = task.name?.trim() || task.branchName?.trim() || "session"
            const variant = task.variant ? ` · ${task.variant}` : ""
            return [`- ${label}: ${name ?? task.model.modelID} (${task.model.providerID})${variant}`]
          })

          return {
            title: `Requested ${tasks.length} Agent Manager ${params.mode === "worktree" ? "worktree" : "local"} session${tasks.length === 1 ? "" : "s"}`,
            output: [
              `Requested ${tasks.length} Agent Manager ${params.mode === "worktree" ? "worktree" : "local"} session${tasks.length === 1 ? "" : "s"}.`,
              `request_id: ${requestID}`,
              ...(resolved.length ? ["Resolved models:", ...resolved] : []),
              "The VS Code extension will create the sessions asynchronously and show progress in Agent Manager.",
            ].join("\n"),
            metadata: { action: "start", requestID, count: tasks.length },
          }
        }),
    }
  }),
)
