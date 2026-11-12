import type { AssertInput } from "@opencode/plugin/permission"
import { Agent } from "@opencode/schema/agent"
import { KiloAgentManagerRpc } from "@opencode/schema/kilocode/agent-manager"
import { Model } from "@opencode/schema/model"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import MODELS_DESCRIPTION from "./agent-manager-models.txt"
import DESCRIPTION from "./agent-manager.txt"
import { Input } from "./input"
import { entries, matchesQuery, selectModel, view, type Source } from "./models"
import { TaskParams } from "./params"
import type { AgentManagerInterface, HostError } from "./service"

type TaskInput = Schema.Schema.Type<typeof TaskParams>

export interface Runtime {
  readonly permission: { readonly assert: (input: AssertInput) => Effect.Effect<void, unknown> }
  readonly session: { readonly model: (sessionID: string) => Effect.Effect<Model.Ref | undefined> }
  readonly agents: {
    readonly list: () => Effect.Effect<ReadonlyArray<Agent.Info>>
    readonly get: (id: Agent.ID) => Effect.Effect<Agent.Info | undefined>
  }
  readonly models: {
    readonly list: () => Effect.Effect<ReadonlyArray<Model.Info>>
    readonly default: () => Effect.Effect<Model.Info | undefined>
  }
  readonly manager: AgentManagerInterface
  readonly start: (event: KiloAgentManagerRpc.Start) => Effect.Effect<void>
}

type Selected = { readonly task?: KiloAgentManagerRpc.Task; readonly error?: string }

const MAX_LIMIT = 20

const ModelsParams = Schema.Struct({
  query: Schema.optional(
    Schema.String.annotate({
      description: "Case-insensitive search across model names and IDs (e.g. 'opus', 'glm 5.2')",
    }),
  ),
  offset: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
      description: "Result offset for pagination (default 0)",
    }),
  ),
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
      description: "Maximum models to return (default 20; hard-capped at 20 to keep output small)",
    }),
  ),
})

const ModelsOutput = Schema.String
const AgentOutput = Schema.String

export function makeTools(runtime: Runtime) {
  const agentManager: Tool.Info<typeof Input, typeof AgentOutput> = {
    name: "agent_manager",
    description: DESCRIPTION,
    input: Input,
    output: AgentOutput,
    execute: (params, context) =>
      Effect.gen(function* () {
        if ("action" in params) {
          if (params.action === "list") {
            yield* ask(runtime, context, "overview", { action: "list" })
            const result = yield* run(
              runtime.manager.request({
                operation: "overview",
                sessionID: context.sessionID,
                ...(params.filter == null ? {} : { filter: params.filter }),
              }),
            )
            if (result.operation !== "overview")
              return yield* Effect.die(new Error("Agent Manager returned the wrong result type"))
            const count =
              (result.overview.local?.sessions.length ?? 0) +
              result.overview.ungrouped.length +
              result.overview.sections.reduce((sum, section) => sum + section.worktrees.length, 0)
            return {
              output: JSON.stringify(
                {
                  instructions:
                    "This overview is the source of truth. Use sections[].id as sectionID and sessions[].id/session.id as sessionID for action=move. Do not edit .kilo2/agent-manager.json.",
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
            const reference = params.replyTo?.trim()
            const replyTo =
              reference && !["none", "null", "undefined"].includes(reference.toLowerCase()) ? reference : undefined
            yield* ask(runtime, context, "prompt", {
              action: "prompt",
              sessionID: params.sessionID,
              ...(replyTo ? { replyTo } : {}),
              description: `Send a prompt to Agent Manager session ${params.sessionID}:\n\n${prompt}`,
            })
            const result = yield* run(
              runtime.manager.request({
                operation: "prompt",
                sessionID: context.sessionID,
                targetSessionID: params.sessionID,
                sourceSessionID: context.sessionID,
                prompt,
                ...(replyTo ? { replyTo } : {}),
              }),
            )
            if (result.operation !== "prompt")
              return yield* Effect.die(new Error("Agent Manager returned the wrong result type"))
            return {
              output: replyTo
                ? `Reply accepted by Agent Manager session ${result.sessionID}. If the session is busy, the reply is queued behind active work. This does not wait for completion.`
                : `Agent Manager session ${result.sessionID} accepted the prompt. If the session is busy, the prompt is queued behind active work. This does not wait for completion.`,
              metadata: { action: "prompt", sessionID: result.sessionID, ...(replyTo ? { replyTo } : {}) },
            }
          }

          if (params.action === "stop") {
            yield* ask(runtime, context, "stop", { action: "stop", sessionID: params.sessionID })
            const result = yield* run(
              runtime.manager.request({
                operation: "stop",
                sessionID: context.sessionID,
                targetSessionID: params.sessionID,
              }),
            )
            if (result.operation !== "stop")
              return yield* Effect.die(new Error("Agent Manager returned the wrong result type"))
            return {
              output: `Stopped Agent Manager session ${result.sessionID} and removed it from Agent Manager.`,
              metadata: { action: "stop", sessionID: result.sessionID },
            }
          }

          if (params.action === "answer") {
            yield* ask(runtime, context, "answer", { action: "answer", sessionID: params.sessionID })
            const result = yield* run(
              runtime.manager.request({
                operation: "answer",
                sessionID: context.sessionID,
                targetSessionID: params.sessionID,
                ...(params.questionID?.trim() ? { questionID: params.questionID.trim() } : {}),
                answers: params.answers,
              }),
            )
            if (result.operation !== "answer")
              return yield* Effect.die(new Error("Agent Manager returned the wrong result type"))
            return {
              output: `Answered Agent Manager question ${result.questionID} for session ${result.sessionID}. The session resumes with those answers.`,
              metadata: { action: "answer", sessionID: result.sessionID, questionID: result.questionID },
            }
          }

          yield* ask(runtime, context, "move", {
            action: "move",
            sessionID: params.sessionID,
            sectionID: params.sectionID,
          })
          const result = yield* run(
            runtime.manager.request({
              operation: "move",
              sessionID: context.sessionID,
              targetSessionID: params.sessionID,
              sectionID: params.sectionID,
            }),
          )
          if (result.operation !== "move")
            return yield* Effect.die(new Error("Agent Manager returned the wrong result type"))
          return {
            output: `Moved Agent Manager session ${result.sessionID} to ${result.sectionID ?? "Ungrouped"}.`,
            metadata: { action: "move", sessionID: result.sessionID, sectionID: result.sectionID },
          }
        }

        const invoking =
          (yield* runtime.session.model(context.sessionID)) ??
          (yield* runtime.agents.get(context.agent))?.model
        const source: Source | undefined = invoking
          ? {
              model: { providerID: invoking.providerID, modelID: invoking.id },
              ...(invoking.variant ? { variant: invoking.variant } : {}),
            }
          : undefined

        const selectable = (yield* runtime.agents.list()).filter((item) => item.mode !== "subagent" && !item.hidden)
        const hint = selectable.length ? ` Available agents: ${selectable.map((item) => item.id).join(", ")}` : ""
        const agentErrors: string[] = []
        for (const task of params.tasks) {
          const name = task.agent?.trim()
          if (!name) continue
          const info = yield* runtime.agents.get(Agent.ID.make(name))
          if (!info) {
            agentErrors.push(`Agent "${name}" not found.${hint}`)
            continue
          }
          if (info.mode === "subagent") {
            agentErrors.push(
              `Agent "${name}" is a subagent (mode: "subagent") and cannot run as an Agent Manager session's primary agent. Set its mode to "all" in config, or use the task tool for subagent work instead.${hint}`,
            )
            continue
          }
          if (info.hidden) {
            agentErrors.push(`Agent "${name}" is an internal agent and cannot run an Agent Manager session.${hint}`)
          }
        }
        if (agentErrors.length > 0) {
          return {
            output: ["No Agent Manager sessions were requested.", ...agentErrors].join("\n"),
            metadata: { action: "start", count: 0 },
          }
        }

        const need = params.tasks.some(
          (task) => task.model?.trim() || task.provider?.trim() || task.variant?.trim(),
        )
        const models = need ? yield* runtime.models.list() : []
        const preferred = need
          ? (source?.model.providerID ?? (yield* runtime.models.default())?.providerID)
          : undefined
        const selected = params.tasks.map((task, index) => select(task, models, source, preferred, index))
        const errors = selected.flatMap((item) => (item.error ? [item.error] : []))
        if (errors.length > 0) {
          return {
            output: [
              "No Agent Manager sessions were requested.",
              ...errors,
              "Use agent_manager_models to find available model names and reasoning variants.",
            ].join("\n"),
            metadata: { action: "start", count: 0 },
          }
        }
        const tasks = selected.flatMap((item) => (item.task ? [item.task] : []))

        yield* ask(runtime, context, params.mode, {
          mode: params.mode,
          count: tasks.length,
          ...(params.worktreeID != null ? { worktreeID: params.worktreeID } : {}),
        })

        const requestID = `am-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`
        yield* runtime.start({
          requestID,
          sessionID: context.sessionID,
          mode: params.mode,
          ...(params.worktreeID != null ? { worktreeID: params.worktreeID } : {}),
          ...(params.versions != null ? { versions: params.versions } : {}),
          tasks,
        })

        const resolved = tasks.flatMap((task, index) => {
          const model = task.model
          if (!params.tasks[index]?.model?.trim() || !model) return []
          const name = models.find((item) => item.providerID === model.providerID && item.id === model.modelID)?.name
          const label = task.name?.trim() || task.branchName?.trim() || "session"
          const variant = task.variant ? ` · ${task.variant}` : ""
          return [`- ${label}: ${name ?? model.modelID} (${model.providerID})${variant}`]
        })

        return {
          output: [
            `Requested ${tasks.length} Agent Manager ${params.mode === "worktree" ? "worktree" : "local"} session${tasks.length === 1 ? "" : "s"}.`,
            `request_id: ${requestID}`,
            ...(params.worktreeID != null ? [`Existing managed worktree: ${params.worktreeID}`] : []),
            ...(resolved.length ? ["Resolved models:", ...resolved] : []),
            "The VS Code extension will create the sessions asynchronously and show progress in Agent Manager.",
          ].join("\n"),
          metadata: { action: "start", requestID, count: tasks.length },
        }
      }),
  }

  const models: Tool.Info<typeof ModelsParams, typeof ModelsOutput> = {
    name: "agent_manager_models",
    description: `${MODELS_DESCRIPTION}\n\nAlso use this tool before choosing model, provider, or variant for the task subagent tool. You may choose these settings to suit the subagent task without creating an Agent Manager session.`,
    input: ModelsParams,
    output: ModelsOutput,
    execute: (params) =>
      Effect.gen(function* () {
        const all = entries(yield* runtime.models.list())
        const query = params.query?.trim()
        const matches = query ? all.filter((entry) => matchesQuery([entry.name, ...entry.ids], query)) : all
        const offset = params.offset ?? 0
        const limit = Math.min(params.limit ?? MAX_LIMIT, MAX_LIMIT)
        const selected = matches.slice(offset, offset + limit).map(view)
        const nextOffset = offset + selected.length < matches.length ? offset + selected.length : undefined
        return {
          output: JSON.stringify({
            models: selected,
            offset,
            total: matches.length,
            nextOffset,
            hint: "Pass a model name as `model`, a listed provider ID as `provider`, and a supported reasoning effort as `variant` to task or agent_manager. Task selection does not create Agent Manager sessions.",
          }),
          metadata: { count: selected.length, total: matches.length },
        }
      }),
  }

  return { agentManager, models }
}

function select(
  task: TaskInput,
  models: ReadonlyArray<Model.Info>,
  source: Source | undefined,
  preferred: string | undefined,
  index: number,
): Selected {
  const base = {
    ...(task.prompt != null ? { prompt: task.prompt } : {}),
    ...(task.name != null ? { name: task.name } : {}),
    ...(task.branchName != null ? { branchName: task.branchName } : {}),
    ...(task.baseBranch?.trim() ? { baseBranch: task.baseBranch.trim() } : {}),
    ...(task.agent?.trim() ? { agent: task.agent.trim() } : {}),
  }
  if (!task.model?.trim() && !task.variant?.trim()) {
    return { task: task.prompt?.trim() && source ? { ...base, ...source } : base }
  }
  const selected = selectModel(task, models, source, preferred)
  if ("error" in selected) return { error: `Task ${index + 1} ${selected.error}` }
  const variant =
    selected.variant ??
    (source && selected.model.providerID === source.model.providerID && selected.model.modelID === source.model.modelID
      ? source.variant
      : undefined)
  return { task: { ...base, ...selected, ...(variant ? { variant } : {}) } }
}

function ask(runtime: Runtime, context: Tool.Context, pattern: string, metadata: Record<string, unknown>) {
  return runtime.permission
    .assert({
      sessionID: context.sessionID,
      agent: context.agent,
      action: "agent_manager",
      resources: [pattern],
      save: [pattern],
      metadata,
    })
    .pipe(
      Effect.mapError((error) =>
        new Tool.Error({ message: error instanceof Error ? error.message : String(error) }),
      ),
    )
}

function run<A>(effect: Effect.Effect<A, HostError>) {
  return effect.pipe(Effect.mapError((error) => new Tool.Error({ message: error.message })))
}
