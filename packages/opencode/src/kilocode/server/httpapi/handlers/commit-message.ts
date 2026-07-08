import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { EffectBridge } from "@/effect/bridge"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Config } from "@/config/config"
import { generateCommitMessage } from "@/kilocode/commit-message"
import { CommitMessagePayload } from "../groups/commit-message"

export const commitMessageHandlers = HttpApiBuilder.group(InstanceHttpApi, "commit-message", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service

    const generate = Effect.fn("CommitMessageHttpApi.generate")(function* (ctx: {
      payload: typeof CommitMessagePayload.Type
    }) {
      const cfg = yield* config.get()
      const prompt = cfg.commit_message?.prompt || undefined
      const result = yield* EffectBridge.fromPromise(() =>
        generateCommitMessage({
          path: ctx.payload.path,
          selectedFiles: ctx.payload.selectedFiles ? [...ctx.payload.selectedFiles] : undefined,
          previousMessage: ctx.payload.previousMessage,
          prompt,
          language: ctx.payload.language,
        }),
      )
      return { message: result.message }
    })

    return handlers.handle("generate", generate)
  }),
)
