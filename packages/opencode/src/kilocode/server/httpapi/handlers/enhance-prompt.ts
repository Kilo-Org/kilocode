import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { EffectBridge } from "@/effect/bridge"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { enhancePrompt } from "@/kilocode/enhance-prompt"
import { disconnect } from "@/kilocode/server/sse"
import { EnhancePromptFailedError, EnhancePromptPayload } from "../groups/enhance-prompt"

export const enhancePromptHandlers = HttpApiBuilder.group(InstanceHttpApi, "enhance-prompt", (handlers) =>
  Effect.gen(function* () {
    const enhance = Effect.fn("EnhancePromptHttpApi.enhance")(function* (ctx: {
      payload: typeof EnhancePromptPayload.Type
    }) {
      // Abort the model call when the client goes away, so a cancelled enhancement stops using tokens.
      // The Node adapter does not interrupt this fiber on every disconnect (see sse.ts), so watch the
      // request too and interrupt when it closes.
      const request = yield* HttpServerRequest.HttpServerRequest
      const abort = new AbortController()
      const text = yield* EffectBridge.fromPromise(() => enhancePrompt(ctx.payload.text, abort.signal)).pipe(
        Effect.catchDefect((defect) =>
          defect instanceof Error
            ? Effect.fail(new EnhancePromptFailedError({ message: defect.message }))
            : Effect.die(defect),
        ),
        Effect.raceFirst(disconnect(request).pipe(Effect.andThen(Effect.interrupt))),
        Effect.onInterrupt(() => Effect.sync(() => abort.abort())),
      )
      return { text }
    })

    return handlers.handle("enhance", enhance)
  }),
)
