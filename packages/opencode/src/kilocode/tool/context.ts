import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { SessionCompaction } from "@/session/compaction"
import { KiloSessionOverflow } from "@/kilocode/session/overflow"
import { KiloSessionMessageOrder } from "@/kilocode/session/message-order"

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
          // filterCompacted reorders messages for model consumption, so array
          // position is not chronology; derive the last finished step the way
          // the prompt loop does.
          const { finished } = KiloSessionMessageOrder.latest(ctx.messages)
          const tokens = finished?.tokens
          const contextTokens = tokens ? KiloSessionOverflow.count(tokens) : 0
          // 0 is the "unknown context window" sentinel, not an exhausted window.
          const limit = session.model
            ? yield* provider.getModel(session.model.providerID, session.model.id).pipe(
                Effect.map((model) => (model.limit.context > 0 ? model.limit.context : undefined)),
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
    // Compaction claim, one per step. The step's frozen message snapshot is the
    // WeakMap key, so the claim is released with the snapshot instead of
    // retaining a sessionID entry for the life of the process; sibling calls
    // inside one assistant step share the snapshot and the same ctx.messageID,
    // and only this claim can collapse them.
    const scheduled = new WeakMap<object, string>()

    return {
      description: COMPACT_DESCRIPTION,
      parameters: Parameters,
      execute: (_args, ctx) =>
        Effect.gen(function* () {
          const latest = KiloSessionMessageOrder.latest(ctx.messages)
          // A compaction part newer than the last finished step is queued work
          // the prompt loop will run; scheduling another would run a second
          // summariser pass over the same history. The claim below is set
          // synchronously, before the first yield, so concurrent siblings
          // cannot both pass it.
          const pending = latest.tasks.some((task) => task.type === "compaction")
          if (pending || scheduled.get(ctx.messages) === ctx.messageID) {
            return {
              title: "context compaction already scheduled",
              metadata: { sessionID: ctx.sessionID, agent: ctx.agent, time: new Date().toISOString(), pending: true },
              output:
                "A context compaction is already scheduled and will summarise the conversation history when this turn finishes; no additional compaction was scheduled.",
            }
          }
          scheduled.set(ctx.messages, ctx.messageID)

          const session = yield* sessions.get(ctx.sessionID)
          const model = session.model
            ? { providerID: session.model.providerID, modelID: session.model.id }
            : latest.user
              ? { providerID: latest.user.model.providerID, modelID: latest.user.model.modelID }
              : undefined
          if (!model) {
            return yield* Effect.fail(new Error("Cannot compact: this session has no model"))
          }

          yield* compaction.create({ sessionID: ctx.sessionID, agent: ctx.agent, model, auto: false })

          return {
            title: "context compaction scheduled",
            metadata: { sessionID: ctx.sessionID, agent: ctx.agent, time: new Date().toISOString(), pending: false },
            output:
              "Context compaction scheduled. The conversation history will be summarised into a summary when this turn finishes; continue with your next step.",
          }
        }).pipe(Effect.orDie),
    }
  }),
)
