import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { KiloTask } from "../kilocode/tool/task" // kilocode_change
import { KiloCostPropagation } from "../kilocode/session/cost-propagation" // kilocode_change
import { KiloSessionProcessor } from "../kilocode/session/processor" // kilocode_change
import { errorMessage } from "@/util/error" // kilocode_change
import { Effect, Exit, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
  // kilocode_change start - allow task tool to launch a child session without awaiting it
  background(input: {
    parent: SessionPrompt.PromptInput
    child: SessionPrompt.PromptInput
    messageID: MessageID
    cost: number
    description: string
    agent: string
  }): Effect.Effect<void>
  // kilocode_change end
}

const id = "task"

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  // kilocode_change start - use agent-oriented task prompt description
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  // kilocode_change end
  // kilocode_change start - support resuming and launching background subagents
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run this subagent in the background so the main agent can continue. The main agent and user will be notified when it completes.",
  }),
  // kilocode_change end
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

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

      const parent = yield* sessions.get(ctx.sessionID)
      // kilocode_change start — inherit edit/bash/MCP restrictions from calling agent
      const caller = yield* agent.get(ctx.agent)
      const rules = KiloTask.inherited({ caller, session: parent, mcp: cfg.mcp })
      // kilocode_change end

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...(parent.permission ?? []).filter(
              (rule) => rule.permission === "external_directory" || rule.action === "deny",
            ),
            ...(canTodo
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(canTask
              ? []
              : [
                  {
                    permission: id,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            // kilocode_change start - preserve primary tool restrictions for child sessions
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
            // kilocode_change start — deny task + propagate caller restrictions
            ...KiloTask.permissions(rules),
            // kilocode_change end
          ],
        })) // kilocode_change
      // kilocode_change end

      // kilocode_change start - keep assistant info for background parent continuation
      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const info = msg.info
      // kilocode_change end

      // kilocode_change start — prefer valid subagent overrides, safely inheriting when overrides go stale
      const selected = yield* KiloTask.resolveModel({
        name: next.name,
        agent: next,
        config: cfg,
        parent: {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        },
      })
      const model = selected.model
      const variant = selected.variant
      // kilocode_change end

      // kilocode_change start - include child task metadata for UI rendering
      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
          variant,
          background: params.background === true,
        },
      })
      // kilocode_change end

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))
      const runCancel = yield* EffectBridge.make()

      const messageID = MessageID.ascending()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      // kilocode_change start - gate background mode behind feature flag and live runtime support;
      // kilo run exits on parent idle, so background fibers would be lost.
      const isBackground =
        params.background === true &&
        cfg.experimental?.background_subagents === true &&
        ctx.extra?.liveBackgroundSubagents === true
      // kilocode_change end

      return yield* Effect.acquireUseRelease(
        // kilocode_change start - snapshot child cost so we propagate only the delta on resume (#6321)
        Effect.gen(function* () {
          ctx.abort.addEventListener("abort", onAbort)
          return yield* KiloCostPropagation.childCost(sessions, nextSession.id)
        }),
        // kilocode_change end
        // kilocode_change start - branch task execution for foreground/background subagents
        (costBefore) =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(params.prompt)
            KiloSessionProcessor.markReviewTelemetry(parts, params.command) // kilocode_change - carry review command into child session telemetry
            // kilocode_change start - share child prompt between foreground and background paths
            const child = {
              messageID,
              sessionID: nextSession.id,
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              variant, // kilocode_change
              agent: next.name,
              tools: {
                ...(canTodo ? {} : { todowrite: false }),
                ...(canTask ? {} : { task: false }),
                ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
              },
              parts,
            }

            const metadata = {
              sessionId: nextSession.id,
              model,
              variant, // kilocode_change
              background: isBackground, // kilocode_change
            }
            // kilocode_change end

            // kilocode_change start - allow the parent agent to continue while the child session runs
            if (isBackground) {
              const parentModel = {
                modelID: info.modelID,
                providerID: info.providerID,
              }
              yield* ops.background({
                description: params.description,
                agent: next.name,
                messageID: ctx.messageID,
                cost: costBefore,
                child,
                parent: {
                  sessionID: ctx.sessionID,
                  agent: ctx.agent,
                  model: parentModel,
                  parts: [
                    {
                      type: "text",
                      synthetic: true,
                      text: [
                        `A background subagent has started.`,
                        "",
                        `Description: ${params.description}`,
                        `Agent: ${next.name}`,
                        `task_id: ${nextSession.id}`,
                        "",
                        "You will be notified when it completes. Continue with the user's task without waiting unless this result is required immediately.",
                      ].join("\n"),
                    },
                  ],
                  noReply: true,
                },
              })

              return {
                title: params.description,
                metadata,
                output: [
                  `task_id: ${nextSession.id} (background subagent running)`,
                  "",
                  "<task_status>",
                  "Background subagent started. You and the user will be notified when it completes.",
                  "</task_status>",
                ].join("\n"),
              }
            }
            // kilocode_change end

            const result = yield* ops.prompt(child) // kilocode_change - uses shared child prompt object

            // kilocode_change start - expose terminal child assistant errors through the task tool boundary
            if (result.info.role === "assistant" && result.info.error) {
              return yield* Effect.fail(new Error(errorMessage(result.info.error)))
            }
            // kilocode_change end

            // kilocode_change start - return resumable task wrapper output
            return {
              title: params.description,
              metadata, // kilocode_change - includes background flag for UI rendering
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                "",
                "<task_result>",
                result.parts.findLast((item) => item.type === "text")?.text ?? "",
                "</task_result>", // kilocode_change - wrap task output for consumers
              ].join("\n"),
            }
            // kilocode_change end
          }),
        // kilocode_change end
        // kilocode_change start - propagate subagent cost delta to parent on every exit path (#6321)
        (costBefore, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* cancel
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                ctx.abort.removeEventListener("abort", onAbort)
                const costAfter = yield* KiloCostPropagation.childCost(sessions, nextSession.id)
                yield* KiloCostPropagation.propagate(sessions, ctx.sessionID, ctx.messageID, costAfter - costBefore)
              }),
            ),
          ),
        // kilocode_change end
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
