import * as Agent from "@/agent/agent"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import * as KiloAgent from "@/kilocode/agent"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { ToolJsonSchema } from "@/tool/json-schema"
import { Tool } from "@/tool/tool"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
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
  provider: Pick<Provider.Interface, "getModel">
  sessions: Pick<Session.Interface, "updateMessage">
  ask: Tool.Context["ask"]
  switched: (input: { sessionID: SessionID; agent: string }) => Effect.Effect<void>
  modelSwitched: (input: {
    sessionID: SessionID
    model: { providerID: ProviderV2.ID; id: ModelV2.ID; variant?: string }
  }) => Effect.Effect<void>
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

export class UnresolvableModelError extends Schema.TaggedErrorClass<UnresolvableModelError>()(
  "ModeSwitchUnresolvableModelError",
  {
    target: Schema.String,
    providerID: Schema.String,
    modelID: Schema.String,
    hint: Schema.optional(Schema.String),
  },
) {
  override get message() {
    return `Mode "${this.target}" is configured with model ${this.providerID}/${this.modelID}, which is not currently available.${this.hint ? ` ${this.hint}` : ""}`
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

// kilocode_change start - mirror prompt.ts: only apply target.variant when the
// resolved destination model actually exposes it; an inherited variant that
// belongs to the previous model would be silently dropped by llm/request.ts.
function pickVariant(variants: Record<string, unknown> | undefined, candidate: string | undefined): string | undefined {
  if (!candidate) return undefined
  if (variants && candidate in variants) return candidate
  return undefined
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
  // Validate the destination model first so an unknown/unavailable one fails the
  // tool with a clean error instead of poisoning the persisted user message and
  // aborting the in-flight turn when getModel dies in the prompt loop.
  const baseModel = current.info.model
  type NextModel = { providerID: ProviderV2.ID; modelID: ModelV2.ID; variant?: string }
  type SwitchModel = { providerID: ProviderV2.ID; id: ModelV2.ID; variant?: ModelV2.VariantID }
  const next = yield* (function (): Effect.Effect<
    { model: NextModel; switchModel: false | SwitchModel },
    UnresolvableModelError
  > {
    return Effect.gen(function* () {
      if (target.model) {
        const exit = yield* Effect.exit(
          deps.provider.getModel(target.model.providerID, target.model.modelID),
        )
        if (Exit.isFailure(exit)) {
          const err = Cause.squash(exit.cause)
          if (Provider.ModelNotFoundError.isInstance(err)) {
            const hint = err.suggestions?.length ? `Did you mean: ${err.suggestions.join(", ")}?` : undefined
            return yield* Effect.fail(
              new UnresolvableModelError({
                target: target.name,
                providerID: err.providerID,
                modelID: err.modelID,
                hint,
              }),
            )
          }
          return yield* Effect.die(err)
        }
        const resolved = exit.value
        const modelChanged =
          resolved.providerID !== baseModel.providerID || resolved.id !== baseModel.modelID
        // The previous variant was chosen for the source model and may not exist on the
        // destination; clear it whenever the provider/model actually changes.
        const nextVariant = modelChanged
          ? pickVariant(resolved.variants, target.variant)
          : (pickVariant(resolved.variants, target.variant) ?? baseModel.variant)
        const variantChanged = nextVariant !== undefined && nextVariant !== (baseModel.variant ?? undefined)
        return {
          model: {
            providerID: resolved.providerID,
            modelID: resolved.id,
            ...(nextVariant ? { variant: nextVariant } : {}),
          },
          switchModel:
            modelChanged || variantChanged
              ? {
                  providerID: resolved.providerID,
                  id: resolved.id,
                  ...(nextVariant ? { variant: nextVariant as ModelV2.VariantID } : {}),
                }
              : false,
        }
      }
      if (target.variant) {
        const exit = yield* Effect.exit(deps.provider.getModel(baseModel.providerID, baseModel.modelID))
        if (Exit.isSuccess(exit)) {
          const valid = pickVariant(exit.value.variants, target.variant)
          if (valid && valid !== baseModel.variant) {
            return {
              model: { providerID: baseModel.providerID, modelID: baseModel.modelID, variant: valid },
              switchModel: {
                providerID: baseModel.providerID,
                id: baseModel.modelID,
                variant: valid as ModelV2.VariantID,
              },
            }
          }
        }
      }
      return { model: baseModel, switchModel: false }
    })
  })()
  yield* deps.sessions.updateMessage({ ...current.info, agent: target.name, model: next.model })
  yield* deps.switched({ sessionID: ctx.sessionID, agent: target.name })
  if (next.switchModel) {
    yield* deps.modelSwitched({ sessionID: ctx.sessionID, model: next.switchModel })
  }
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
  Agent.Service | Config.Service | Provider.Service | Session.Service | EventV2Bridge.Service,
  "mode_switch"
>(
  "mode_switch",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
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
          provider,
          sessions,
          ask: ctx.ask,
          switched: (input) =>
            events.publish(SessionEvent.AgentSwitched, {
              sessionID: input.sessionID,
              messageID: SessionMessage.ID.create(),
              timestamp: DateTime.makeUnsafe(Date.now()),
              agent: input.agent,
            }),
          modelSwitched: (input) =>
            events.publish(SessionEvent.ModelSwitched, {
              sessionID: input.sessionID,
              messageID: SessionMessage.ID.create(),
              timestamp: DateTime.makeUnsafe(Date.now()),
              model: {
                providerID: input.model.providerID,
                id: input.model.id,
                ...(input.model.variant
                  ? { variant: ModelV2.VariantID.make(input.model.variant) }
                  : {}),
              },
            }),
        }).pipe(Effect.orDie),
    }
  }),
)
