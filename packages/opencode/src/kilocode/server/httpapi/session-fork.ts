import { SessionID } from "@/session/schema"
import { ForkPayload } from "@/server/routes/instance/httpapi/groups/session"
import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiError } from "effect/unstable/httpapi"

export namespace KiloSessionHttpApi {
  type Input = {
    params: { sessionID: SessionID }
    payload: typeof ForkPayload.Type
  }

  type Raw = {
    params: { sessionID: SessionID }
    request: HttpServerRequest.HttpServerRequest
  }

  export function forkRaw<A extends { id: SessionID }, E, R>(fork: (ctx: Input) => Effect.Effect<A, E, R>) {
    return Effect.fn("KiloSessionHttpApi.forkRaw")(function* (ctx: Raw) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Effect.gen(function* () {
        if (body.trim().length === 0) return {}

        const json = yield* Effect.try({
          try: () => JSON.parse(body) as unknown,
          catch: () => new HttpApiError.BadRequest({}),
        })
        return yield* Schema.decodeUnknownEffect(ForkPayload)(json).pipe(
          Effect.mapError(() => new HttpApiError.BadRequest({})),
        )
      })
      return yield* fork({ params: ctx.params, payload })
    })
  }
}
