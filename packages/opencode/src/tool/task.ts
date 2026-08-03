import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider" // kilocode_change
import { KiloTask } from "../kilocode/tool/task" // kilocode_change
import { KiloTaskBackgroundProcess } from "../kilocode/tool/task-background-process" // kilocode_change
import { KiloCostPropagation } from "../kilocode/session/cost-propagation" // kilocode_change
import { KiloSessionProcessor } from "../kilocode/session/processor" // kilocode_change
import { KiloSession } from "../kilocode/session" // kilocode_change
import { errorMessage } from "@/util/error" // kilocode_change
import { Effect, Exit, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as SandboxPolicy from "@/kilocode/sandbox/policy" // kilocode_change
import { Database } from "@opencode-ai/core/database/database"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
].join(" ")
const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")
const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "The provider/model to use for this task, overriding configured subagent model selection",
  }),
  variant: Schema.optional(Schema.String).annotate({
    description: "The model variant or reasoning effort to use for this task",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})

function renderOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  // kilocode_change start - surface the resumable task_id when a background subagent fails (#11620)
  const hint = resumeHint(input.sessionID)
  const body = input.state === "error" && !input.text.includes(hint) ? `${input.text}\n${hint}` : input.text
  // kilocode_change end
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    body, // kilocode_change - was input.text
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

// kilocode_change start - tell the parent agent how to resume a stopped/failed subagent (#11620)
function resumeHint(sessionID: SessionID) {
  return [
    `This subagent session can be resumed: call the task tool again with task_id="${sessionID}"`,
    `and a prompt describing how to continue or recover. Its prior context is preserved.`,
  ].join(" ")
}
// kilocode_change end

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const provider = yield* Provider.Service // kilocode_change
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const runInBackground = params.background === true
      if (runInBackground && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(new Error("Background subagents require KILO_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"))
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }
      // kilocode_change start — reject primary agents; only subagent/all modes allowed
      KiloTask.validate(next, params.subagent_type)
      // kilocode_change end

      const canTask = KiloTask.nestedTask() // kilocode_change - Kilo disallows subagents spawning subagents
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const session = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      if (session && session.parentID !== ctx.sessionID) {
        return yield* Effect.fail(
          new Error(`Cannot resume session ${params.task_id}: not a child of the current session`),
        ) // kilocode_change - prevent cross-session task resume
      }
      const parent = yield* sessions.get(ctx.sessionID)
      // kilocode_change start — inherit edit/bash/MCP restrictions from calling agent
      const caller = yield* agent.get(ctx.agent)
      const rules = KiloTask.inherited({ caller, session: parent, mcp: cfg.mcp })
      const childPermission = KiloTask.merge(
        deriveSubagentSessionPermission({
          parentSessionPermission: parent.permission ?? [],
          subagent: next,
        }),
        cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*",
          action: "deny" as const,
        })) ?? [],
        KiloTask.permissions(rules),
      )
      // kilocode_change end
      // kilocode_change start - refresh current parent restrictions when resuming an existing task session
      const fallback = SandboxPolicy.fallback(cfg)
      if (session) {
        yield* SandboxPolicy.inherit(ctx.sessionID, session.id, fallback)
        const permission = KiloTask.merge(session.permission ?? [], childPermission)
        session.permission = permission
        yield* sessions.setPermission({ sessionID: session.id, permission })
      }
      // kilocode_change end
      const platform = KiloSession.resolvePlatform(ctx.sessionID) // kilocode_change - preserve parent attribution across task creation/resume
      // kilocode_change start - create a child session with inherited Kilo restrictions
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          agent: next.name,
          platform, // kilocode_change
          permission: childPermission, // kilocode_change - persist inherited Kilo ceilings and upstream child denies
        }))
      // kilocode_change end
      // kilocode_change start - rebuild in-memory ancestry and inherit confinement after creation/resume
      KiloSession.register({ id: nextSession.id, parentID: ctx.sessionID, platform })
      yield* SandboxPolicy.inherit(ctx.sessionID, nextSession.id, fallback).pipe(
        Effect.provideService(Config.Service, config),
      )
      // kilocode_change end

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      // kilocode_change start — prefer valid subagent overrides, safely inheriting when overrides go stale
      const selected = yield* KiloTask.resolveModel({
        name: next.name,
        agent: next,
        config: cfg,
        parent: {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        },
        variant: msg.info.variant,
        callModel: params.model,
        callVariant: params.variant,
        provider,
      })
      const model = selected.model
      const variant = selected.variant
      // kilocode_change end
      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        variant, // kilocode_change
        ...(runInBackground ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const runTask = Effect.fn("TaskTool.runTask")(
        function* () {
          const parts = yield* ops.resolvePromptParts(params.prompt)
          KiloSessionProcessor.markReviewTelemetry(parts, params.command) // kilocode_change - carry review command into child session telemetry
          const result = yield* ops.prompt({
            messageID: MessageID.ascending(),
            sessionID: nextSession.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            variant, // kilocode_change
            agent: next.name,
            tools: {
              question: false, // kilocode_change - subagents cannot prompt the user directly
              interactive_terminal: false, // kilocode_change - subagents cannot take over the user's terminal
              ...(canTodo ? {} : { todowrite: false }),
              ...(canTask ? {} : { task: false }),
              ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
            },
            parts,
          })
          // kilocode_change start - expose terminal child assistant errors through the task tool boundary,
          // including the resumable task_id so the parent agent can continue the subagent (#11620)
          if (result.info.role === "assistant" && result.info.error) {
            return yield* Effect.fail(new Error(`${errorMessage(result.info.error)}\n${resumeHint(nextSession.id)}`))
          }
          // kilocode_change end
          return result.parts.findLast((item) => item.type === "text")?.text ?? ""
        },
        Effect.ensuring(KiloTaskBackgroundProcess.finish(nextSession.id)),
      ) // kilocode_change - transfer inherited processes when the child run ends

      // kilocode_change start - inject completed background task results into the parent session
      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (
        state: "completed" | "error",
        text: string,
      ) {
        const currentParent = yield* sessions.get(ctx.sessionID)
        yield* ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            variant,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: renderOutput({
                  sessionID: nextSession.id,
                  state,
                  summary:
                    state === "completed"
                      ? `Background task completed: ${params.description}`
                      : `Background task failed: ${params.description}`,
                  text,
                }),
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })
      // kilocode_change end

      // kilocode_change start - background tasks propagate only cost accrued by this invocation
      const notify = Effect.fn("TaskTool.notifyBackgroundResult")(function* (jobID: string) {
        yield* background.wait({ id: jobID }).pipe(
          Effect.flatMap((result) => {
            if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
            if (result.info?.status === "error") return inject("error", result.info.error ?? "")
            return Effect.void
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      const withCostPropagation = <A, E, R>(task: Effect.Effect<A, E, R>) =>
        Effect.acquireUseRelease(
          KiloCostPropagation.childCost(sessions, nextSession.id),
          () => task,
          (costBefore) =>
            Effect.gen(function* () {
              const costAfter = yield* KiloCostPropagation.childCost(sessions, nextSession.id)
              yield* KiloCostPropagation.propagate(sessions, ctx.sessionID, ctx.messageID, costAfter - costBefore).pipe(
                Effect.provideService(Database.Service, database),
              )
            }),
        )

      const backgroundRun = withCostPropagation(runTask().pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id))))
      // kilocode_change end

      if (
        yield* background.extend({
          id: nextSession.id,
          // kilocode_change - extended background work also propagates its cost
          run: withCostPropagation(runTask().pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id)))),
        })
      ) {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: nextSession.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task updated",
            text: BACKGROUND_UPDATED,
          }),
        }
      }

      const foregroundCost = runInBackground
        ? undefined
        : yield* KiloCostPropagation.childCost(sessions, nextSession.id) // kilocode_change - snapshot before the foreground job starts
      const info = yield* background.start({
        id: nextSession.id,
        type: id,
        title: params.description,
        metadata,
        onPromote: Effect.all([
          ctx.metadata({
            title: params.description,
            metadata: { ...metadata, background: true, jobId: nextSession.id },
          }),
          notify(nextSession.id),
        ]),
        // kilocode_change - only the initial-background start needs its own cost bracket; the
        // foreground/promoted path below is already wrapped by the acquireUseRelease at the bottom of run()
        run: runInBackground ? backgroundRun : runTask().pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id))),
      })

      function backgroundResult() {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: info.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task started",
            text: BACKGROUND_STARTED,
          }),
        }
      }

      if (runInBackground) {
        yield* notify(info.id)
        return backgroundResult()
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        // kilocode_change start - snapshot child cost so we propagate only the delta on resume (#6321)
        Effect.gen(function* () {
          ctx.abort.addEventListener("abort", onAbort)
          return foregroundCost ?? (yield* KiloCostPropagation.childCost(sessions, nextSession.id))
        }),
        // kilocode_change end
        () =>
          Effect.gen(function* () {
            const result = yield* Effect.raceFirst(
              background.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
              background.waitForPromotion(nextSession.id),
            )
            if (result?.metadata?.background === true) return backgroundResult()
            if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            if (result?.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
            return {
              title: params.description,
              metadata,
              output: renderOutput({ sessionID: nextSession.id, state: "completed", text: result?.output ?? "" }),
            }
          }),
        // kilocode_change start - propagate subagent cost delta to parent on every exit path (#6321)
        (costBefore, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit))
              yield* Effect.all([cancel, background.cancel(nextSession.id)], { discard: true })
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                ctx.abort.removeEventListener("abort", onAbort)
                const costAfter = yield* KiloCostPropagation.childCost(sessions, nextSession.id).pipe(
                  Effect.catchTag("NotFoundError", () => Effect.succeed(costBefore)),
                )
                yield* KiloCostPropagation.propagate(
                  sessions,
                  ctx.sessionID,
                  ctx.messageID,
                  costAfter - costBefore,
                ).pipe(
                  Effect.provideService(Database.Service, database),
                  Effect.catchTag("NotFoundError", () => Effect.void),
                )
              }),
            ),
          ),
        // kilocode_change end
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents
        ? [DESCRIPTION, BACKGROUND_DESCRIPTION].join("\n\n")
        : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
