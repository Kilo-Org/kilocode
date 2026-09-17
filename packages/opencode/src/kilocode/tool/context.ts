import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { SessionCompaction } from "@/session/compaction"
import { KiloSessionOverflow } from "@/kilocode/session/overflow"

const Parameters = Schema.Struct({})

const CONTEXT_INFO_DESCRIPTION =
  "Return your current context information together with the current time: session id, agent, active model, message and part counts, the token usage of the last completed step, the model's context window limit, the tokens remaining, and the ISO timestamp. Experimental."

const COMPACT_DESCRIPTION =
  "Compact your own context. Schedules a compaction that summarises the conversation history into a summary after this turn, freeing context window space. Experimental."

export const ContextInfoTool = Tool.define(
  "get_context_info",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const provider = yield* Provider.Service

    return {
      description: CONTEXT_INFO_DESCRIPTION,
      parameters: Parameters,
      execute: (_args, ctx) =>
        Effect.gen(function* () {
          const session = yield* sessions.get(ctx.sessionID)
          const final = [...ctx.messages].reverse().find((m) => m.info.role === "assistant" && m.info.finish)
          const tokens = final && final.info.role === "assistant" ? final.info.tokens : undefined
          const contextTokens = tokens ? KiloSessionOverflow.count(tokens) : 0
          const limit = session.model
            ? yield* provider.getModel(session.model.providerID, session.model.id).pipe(
                Effect.map((model) => model.limit.context),
                Effect.catchCause(() => Effect.succeed(undefined)),
              )
            : undefined

          const info = {
            time: new Date().toISOString(),
            sessionID: ctx.sessionID,
            agent: ctx.agent,
            model: session.model ? `${session.model.providerID}/${session.model.id}` : null,
            messages: ctx.messages.length,
            parts: ctx.messages.reduce((n, m) => n + m.parts.length, 0),
            tokens: tokens ?? null,
            contextTokens,
            contextLimit: limit ?? null,
            contextRemaining: limit === undefined ? null : Math.max(0, limit - contextTokens),
          }

          return {
            title: "context info",
            metadata: info,
            output: JSON.stringify(info, null, 2),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const CompactTool = Tool.define(
  "compact",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const compaction = yield* SessionCompaction.Service

    return {
      description: COMPACT_DESCRIPTION,
      parameters: Parameters,
      execute: (_args, ctx) =>
        Effect.gen(function* () {
          const session = yield* sessions.get(ctx.sessionID)
          const last = [...ctx.messages].reverse().find((m) => m.info.role === "user")
          const model = session.model
            ? { providerID: session.model.providerID, modelID: session.model.id }
            : last && last.info.role === "user"
              ? { providerID: last.info.model.providerID, modelID: last.info.model.modelID }
              : undefined
          if (!model) {
            return yield* Effect.fail(new Error("Cannot compact: this session has no model"))
          }

          yield* compaction.create({ sessionID: ctx.sessionID, agent: ctx.agent, model, auto: false })

          return {
            title: "context compaction scheduled",
            metadata: { sessionID: ctx.sessionID, agent: ctx.agent, time: new Date().toISOString() },
            output:
              "Context compaction scheduled. The conversation history will be summarised into a summary when this turn finishes; continue with your next step.",
          }
        }).pipe(Effect.orDie),
    }
  }),
)
