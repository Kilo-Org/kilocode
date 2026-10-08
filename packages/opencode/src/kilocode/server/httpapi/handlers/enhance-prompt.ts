import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { EffectBridge } from "@/effect/bridge"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { enhancePrompt } from "@/kilocode/enhance-prompt"
import { EnhancePromptPayload } from "../groups/enhance-prompt"

export const enhancePromptHandlers = HttpApiBuilder.group(InstanceHttpApi, "enhance-prompt", (handlers) =>
  Effect.gen(function* () {
    const enhance = Effect.fn("EnhancePromptHttpApi.enhance")(function* (ctx: {
      payload: typeof EnhancePromptPayload.Type
    }) {
      // The server interrupts this fiber when the client closes the request.
      // Abort the model call too, so a cancelled enhancement stops using tokens.
      const abort = new AbortController()
      const text = yield* EffectBridge.fromPromise(() => enhancePrompt(ctx.payload.text, abort.signal)).pipe(
        Effect.onInterrupt(() => Effect.sync(() => abort.abort())),
      )
      return { text }
    })

    return handlers.handle("enhance", enhance)
  }),
)
