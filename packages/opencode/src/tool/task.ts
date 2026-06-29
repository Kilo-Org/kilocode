import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
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
import { Cause, Effect, Exit, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as SandboxPolicy from "@/kilocode/sandbox/policy" // kilocode_change

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "",
  "",
  [
    "Background mode: background=true launches the subagent asynchronously and returns immediately.",
    "Foreground is the default; use it when you need the result before continuing.",
    "Use background only for independent work that can run while you continue elsewhere.",
    "You will be notified automatically when it finishes.",
  ].join(" "),
].join("\n")

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description: "Run the agent in the background. You will be notified when it completes.",
  }),
})

function output(sessionID: SessionID, text: string) {
  return [`<task id="${sessionID}" state="completed">`, "<task_result>", text, "</task_result>", "</task>"].join("\n")
}

function backgroundOutput(sessionID: SessionID) {
  return [
    `<task id="${sessionID}" state="running">`,
    "<summary>Background task started</summary>",
    "<task_result>",
    "Background task started. You will be notified automatically when it finishes; do not poll for progress.",
    "Do not duplicate its work. Continue only with non-overlapping work, or stop if there is nothing else useful to do.",
    "</task_result>",
    "</task>",
  ].join("\n")
}

function backgroundMessage(input: {
  sessionID: SessionID
  description: string
  state: "completed" | "error"
  text: string
}) {
  const tag = input.state === "completed" ? "task_result" : "task_error"
  const title =
    input.state === "completed"
      ? `Background task completed: ${input.description}`
      : `Background task failed: ${input.description}`
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    `<summary>${title}</summary>`,
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

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
      const parentAgent = parent.agent
        ? yield* agent.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      // kilocode_change start — inherit edit/bash/MCP restrictions from calling agent
      const caller = yield* agent.get(ctx.agent)
      const rules = KiloTask.inherited({ caller, session: parent, mcp: cfg.mcp })
      // kilocode_change end
      // kilocode_change start - refresh current parent restrictions when resuming an existing task session
      const mode: "allow" | "deny" = cfg.experimental?.sandbox_restrict_network === false ? "allow" : "deny"
      const fallback = { enabled: cfg.experimental?.sandbox ?? false, mode }
      if (session) {
        yield* SandboxPolicy.inherit(ctx.sessionID, session.id, fallback)
        const permission = KiloTask.merge(
          session.permission ?? [],
          deriveSubagentSessionPermission({
            parentSessionPermission: parent.permission ?? [],
            parentAgent,
            subagent: next,
          }),
          KiloTask.permissions(rules),
        )
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
          platform, // kilocode_change
          // kilocode_change start - dedupe inherited restrictions before child prompt toggles persist
          permission: KiloTask.merge(
            deriveSubagentSessionPermission({
              parentSessionPermission: parent.permission ?? [],
              parentAgent,
              subagent: next,
            }),
            cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? [],
            KiloTask.permissions(rules),
          ),
          // kilocode_change end
        }))
      // kilocode_change end
      // kilocode_change start - rebuild in-memory ancestry and inherit confinement after creation/resume
      KiloSession.register({ id: nextSession.id, parentID: ctx.sessionID, platform })
      yield* SandboxPolicy.inherit(ctx.sessionID, nextSession.id, fallback)
      // kilocode_change end

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(Effect.orDie)
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

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
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
            ...(canTodo ? {} : { todowrite: false }),
            ...(canTask ? {} : { task: false }),
            ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
          },
          parts,
        })
        // kilocode_change start - expose terminal child assistant errors through the task tool boundary
        if (result.info.role === "assistant" && result.info.error) {
          return yield* Effect.fail(new Error(errorMessage(result.info.error)))
        }
        // kilocode_change end
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      }, Effect.ensuring(KiloTaskBackgroundProcess.finish(nextSession.id))) // kilocode_change - transfer inherited processes when the child run ends

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
            parts: [
              {
                type: "text",
                synthetic: true,
                text: backgroundMessage({
                  sessionID: nextSession.id,
                  description: params.description,
                  state,
                  text,
                }),
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })
      // kilocode_change end

      const existing = yield* background.get(nextSession.id)
      if (existing?.status === "running") {
        return yield* Effect.fail(new Error(`Task ${nextSession.id} is already running.`))
      }

      if (runInBackground) {
        const info = yield* background.start({
          id: nextSession.id,
          type: id,
          title: params.description,
          metadata,
          // kilocode_change start - background tasks propagate only cost accrued by this invocation
          run: Effect.acquireUseRelease(
            KiloCostPropagation.childCost(sessions, nextSession.id),
            () =>
              runTask().pipe(
                Effect.tap((text) => inject("completed", text).pipe(Effect.ignore)),
                Effect.catchCause((cause) =>
                  (Cause.hasInterruptsOnly(cause)
                    ? Effect.void
                    : inject("error", errorText(Cause.squash(cause))).pipe(Effect.ignore)
                  ).pipe(Effect.andThen(Effect.failCause(cause))),
                ),
              ),
            (costBefore) =>
              Effect.gen(function* () {
                const costAfter = yield* KiloCostPropagation.childCost(sessions, nextSession.id)
                yield* KiloCostPropagation.propagate(sessions, ctx.sessionID, ctx.messageID, costAfter - costBefore)
              }),
          ),
          // kilocode_change end
        })

        return {
          title: params.description,
          metadata: {
            ...metadata,
            jobId: info.id,
          },
          output: backgroundOutput(nextSession.id),
        }
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
          return yield* KiloCostPropagation.childCost(sessions, nextSession.id)
        }),
        // kilocode_change end
        () =>
          Effect.gen(function* () {
            const text = yield* runTask()
            return {
              title: params.description,
              metadata,
              output: output(nextSession.id, text),
            }
          }),
        // kilocode_change start - propagate subagent cost delta to parent on every exit path (#6321)
        (costBefore, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* cancel
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
                ).pipe(Effect.catchTag("NotFoundError", () => Effect.void))
              }),
            ),
          ),
        // kilocode_change end
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents ? DESCRIPTION + BACKGROUND_DESCRIPTION : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
