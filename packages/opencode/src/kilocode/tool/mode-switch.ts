import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import * as KiloAgent from "@/kilocode/agent"
import { Permission } from "@/permission"
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
  status: "switched" | "continued" | "stopped"
  source: string
  target: string
  reason: string
}

type Deps = {
  agents: Pick<Agent.Interface, "list" | "guardRequirements">
  config: Pick<Config.Interface, "get">
  sessions: Pick<Session.Interface, "updateMessage">
  ask: Tool.Context["ask"]
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

    const action = (yield* deps.config.get()).mode_switch_on_reject ?? "continue"
    if (action === "stop") {
      return {
        title: "Mode switch cancelled · Task stopped",
        output: `The requested switch from ${source} to ${target.name} was cancelled. The task stops.`,
        metadata: { status: "stopped", source, target: target.name, reason: params.reason } satisfies Meta,
      }
    }
    return {
      title: `Mode switch cancelled · Task continues in ${source}`,
      output: `The requested switch from ${source} to ${target.name} was cancelled. The task continues in ${source}.`,
      metadata: { status: "continued", source, target: target.name, reason: params.reason } satisfies Meta,
    }
  }

  const current = user(ctx.messages)
  // The role check is needed both as a safety guard and to narrow `info` from
  // `User | Assistant` to `User` for the model/variant rewrite below.
  if (!current || current.info.role !== "user")
    return yield* Effect.die(new Error("Mode switch has no active user task"))
  // kilocode_change start - carry the destination mode's configured model/variant so the
  // resumed turn uses them (prompt.ts re-reads the last user message's model on every step).
  const nextModel = target.model
    ? {
        ...current.info.model,
        providerID: target.model.providerID,
        modelID: target.model.modelID,
        ...(target.variant ? { variant: target.variant } : {}),
      }
    : target.variant
      ? { ...current.info.model, variant: target.variant }
      : current.info.model
  yield* deps.sessions.updateMessage({ ...current.info, agent: target.name, model: nextModel })
  yield* deps.switched({ sessionID: ctx.sessionID, agent: target.name })
  // kilocode_change end

  return {
    title: `Mode switched: ${source} → ${target.name}`,
    output: `Switched the active mode from ${source} to ${target.name}. Reason: ${params.reason}. The same task will now resume in ${target.name}.`,
    metadata: { status: "switched", source, target: target.name, reason: params.reason } satisfies Meta,
  }
})

export const ModeSwitchTool = Tool.define<
  typeof Params,
  Meta,
  Agent.Service | Config.Service | Session.Service | EventV2Bridge.Service,
  "mode_switch"
>(
  "mode_switch",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    return {
      description:
        "Switch the active mode for the current task when another built-in mode is better suited. Provide the destination mode and a short reason. The task automatically resumes with its existing context after approval.",
      parameters: Params,
      execute: (params, ctx) =>
        execute(params, ctx, {
          agents,
          config,
          sessions,
          ask: ctx.ask,
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
