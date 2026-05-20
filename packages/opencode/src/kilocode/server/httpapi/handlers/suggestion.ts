import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { Suggestion } from "@/kilocode/suggestion"
import { SessionID } from "@/session/schema"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { SuggestionAcceptPayload } from "../groups/suggestion"

export const suggestionHandlers = HttpApiBuilder.group(InstanceHttpApi, "suggestion", (handlers) =>
  Effect.gen(function* () {
    const list = Effect.fn("SuggestionHttpApi.list")(function* () {
      const items = yield* Effect.promise(() => Suggestion.list())
      // sessionID comes from zod as plain string; cast to branded SessionID for the
      // Effect Schema response type (no runtime change — same string).
      return items.map((item) => ({ ...item, sessionID: SessionID.make(item.sessionID) }))
    })

    const accept = Effect.fn("SuggestionHttpApi.accept")(function* (ctx: {
      params: { requestID: string }
      payload: typeof SuggestionAcceptPayload.Type
    }) {
      const ok = yield* Effect.promise(() =>
        Suggestion.accept({ requestID: ctx.params.requestID, index: ctx.payload.index }),
      )
      if (!ok) return yield* new HttpApiError.NotFound({})
      return true
    })

    const dismiss = Effect.fn("SuggestionHttpApi.dismiss")(function* (ctx: { params: { requestID: string } }) {
      const ok = yield* Effect.promise(() => Suggestion.dismiss(ctx.params.requestID))
      if (!ok) return yield* new HttpApiError.NotFound({})
      return true
    })

    return handlers.handle("list", list).handle("accept", accept).handle("dismiss", dismiss)
  }),
)
