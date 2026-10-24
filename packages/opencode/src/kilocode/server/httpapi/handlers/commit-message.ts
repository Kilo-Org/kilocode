import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { EffectBridge } from "@/effect/bridge"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Config } from "@/config/config"
import { Database } from "@opencode-ai/core/database/database"
import { KiloHookGit } from "@/kilocode/hooks/git"
import { generateCommitMessage, NoChangesError } from "@/kilocode/commit-message"
import { CommitMessageFailedError, CommitMessageNoChangesError, CommitMessagePayload } from "../groups/commit-message"

export const commitMessageHandlers = HttpApiBuilder.group(InstanceHttpApi, "commit-message", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const database = yield* Database.Service

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
      ).pipe(
        Effect.catchDefect((defect) => {
          if (defect instanceof NoChangesError) {
            return Effect.fail(new CommitMessageNoChangesError({ message: defect.message }))
          }
          if (defect instanceof Error) {
            return Effect.fail(new CommitMessageFailedError({ message: defect.message }))
          }
          return Effect.die(defect)
        }),
      )
      // CommitMessage hooks can rewrite the message or reject it, like a failed generation.
      const message = yield* KiloHookGit.commit({
        path: ctx.payload.path,
        message: result.message,
        selected: ctx.payload.selectedFiles,
        previous: ctx.payload.previousMessage,
        language: ctx.payload.language,
        config,
        database,
      }).pipe(Effect.mapError((err) => new CommitMessageFailedError({ message: err.message })))
      return { message }
    })

    return handlers.handle("generate", generate)
  }),
)
