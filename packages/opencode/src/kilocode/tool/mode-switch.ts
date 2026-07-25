import { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import * as KiloAgent from "@/kilocode/agent"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { ToolJsonSchema } from "@/tool/json-schema"
import { Tool } from "@/tool/tool"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Cause, Effect, Exit, Schema } from "effect"
import * as DateTime from "effect/DateTime"

const Params = Schema.Struct({
  target: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64)).annotate({
    description: "The built-in mode to activate",
  }),
  reason: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(240)).annotate({
    description: "A short explanation of why the task needs the destination mode",
  }),
})

export type Params = typeof Params.Type

type Meta = {
  status: "switched" | "continued"
  source: string
  target: string
  reason: string
}

type Deps = {
  agents: Pick<Agent.Interface, "list" | "guardRequirements">
  sessions: Pick<Session.Interface, "updateMessage">
  ask: Tool.Context["ask"]
  question: Pick<Question.Interface, "ask">
  switched: (input: { sessionID: SessionID; agent: string }) => Effect.Effect<void>
}

export class UnavailableError extends Schema.TaggedErrorClass<UnavailableError>()("ModeSwitchUnavailableError", {
  target: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Cannot switch to mode "${this.target}". Choose one of: ${this.available.join(", ")}`
  }
}

export class ActiveError extends Schema.TaggedErrorClass<ActiveError>()("ModeSwitchActiveError", {
  target: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Mode "${this.target}" is already active. Choose a different mode: ${this.available.join(", ")}`
  }
}

export function modes(items: Agent.Info[]) {
  return items.filter((item) => item.native === true && item.mode !== "subagent" && item.hidden !== true)
}

export function schema(items: Agent.Info[]) {
  const base = ToolJsonSchema.fromSchema(Params)
  const target = base.properties?.target
  if (!target || typeof target !== "object") return base
  return {
    ...base,
    properties: {
      ...base.properties,
      target: {
        ...target,
        enum: modes(items).map((item) => item.name),
      },
    },
  }
}

function denied(err: unknown) {
  return (
    err instanceof Permission.DeniedError ||
    err instanceof Permission.RejectedError ||
    err instanceof Permission.CorrectedError
  )
}

function user(messages: MessageV2.WithParts[]) {
  return messages.findLast((item) => item.info.role === "user")
}

export const execute = Effect.fn("ModeSwitch.execute")(function* (
  params: Params,
  ctx: Pick<Tool.Context, "sessionID" | "messageID" | "callID" | "agent" | "messages">,
  deps: Deps,
) {
  const source = ctx.agent
  const available = modes(yield* deps.agents.list())
  const name = KiloAgent.resolveKey(params.target)
  const target = available.find((item) => item.name === name)
  const choices = available.filter((item) => item.name !== source).map((item) => item.name)
  if (!target) {
    return yield* new UnavailableError({
      target: params.target,
      available: choices,
    })
  }
  if (target.name === source) return yield* new ActiveError({ target: target.name, available: choices })
  yield* deps.agents.guardRequirements(target)

  const approval = yield* deps
    .ask({
      permission: "mode_switch",
      patterns: ["*"],
      always: ["*"],
      metadata: { source, target: target.name, reason: params.reason },
    })
    .pipe(Effect.exit)

  if (Exit.isFailure(approval)) {
    const err = Cause.squash(approval.cause)
    if (!denied(err)) return yield* Effect.failCause(approval.cause)

    const answers = yield* deps.question.ask({
      sessionID: ctx.sessionID,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
      questions: [
        {
          header: "Mode switch denied",
          question: `Switching from ${source} to ${target.name} was denied. Reason: ${params.reason}. Continue in ${source} or cancel this task?`,
          options: [
            {
              label: "Continue current mode",
              description: `Resume the same task in ${source}.`,
              mode: source,
            },
            {
              label: "Cancel task",
              description: "Stop without another model step.",
            },
          ],
          multiple: false,
          custom: false,
        },
      ],
    })
    if (!answers[0]?.includes("Continue current mode")) return yield* new Question.RejectedError()
    return {
      title: `Mode switch denied: ${source} → ${target.name}`,
      output: `The requested switch from ${source} to ${target.name} was denied. The user explicitly chose to continue in ${source}. Reason: ${params.reason}`,
      metadata: { status: "continued", source, target: target.name, reason: params.reason } satisfies Meta,
    }
  }

  const current = user(ctx.messages)
  if (!current || current.info.role !== "user")
    return yield* Effect.die(new Error("Mode switch has no active user task"))
  yield* deps.sessions.updateMessage({ ...current.info, agent: target.name })
  yield* deps.switched({ sessionID: ctx.sessionID, agent: target.name })

  return {
    title: `Mode switched: ${source} → ${target.name}`,
    output: `Switched the active mode from ${source} to ${target.name}. Reason: ${params.reason}. The same task will now resume in ${target.name}.`,
    metadata: { status: "switched", source, target: target.name, reason: params.reason } satisfies Meta,
  }
})

export const ModeSwitchTool = Tool.define<
  typeof Params,
  Meta,
  Agent.Service | Session.Service | Question.Service | EventV2Bridge.Service,
  "mode_switch"
>(
  "mode_switch",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service
    const question = yield* Question.Service
    const events = yield* EventV2Bridge.Service
    return {
      description:
        "Switch the active mode for the current task when another built-in mode is better suited. Provide the destination mode and a short reason. The task automatically resumes with its existing context after approval.",
      parameters: Params,
      execute: (params, ctx) =>
        execute(params, ctx, {
          agents,
          sessions,
          ask: ctx.ask,
          question,
          switched: (input) =>
            events.publish(SessionEvent.AgentSwitched, {
              sessionID: input.sessionID,
              messageID: SessionMessage.ID.create(),
              timestamp: DateTime.makeUnsafe(Date.now()),
              agent: input.agent,
            }),
        }).pipe(Effect.orDie),
    }
  }),
)
