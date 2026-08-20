import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionResumeImport } from "@/kilocode/session-resume/import"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { SessionResumeFailedError, SessionResumePayload } from "../groups/session-resume"

export const sessionResumeHandlers = HttpApiBuilder.group(InstanceHttpApi, "session-resume", (handlers) =>
  Effect.gen(function* () {
    const doImport = Effect.fn("SessionResumeHttpApi.import")(function* (ctx: {
      payload: typeof SessionResumePayload.Type
    }) {
      const result = yield* SessionResumeImport.fromContent({
        sessionID: ctx.payload.sessionID,
        content: ctx.payload.content,
        agent: ctx.payload.agent,
        model: ctx.payload.model,
      }).pipe(
        Effect.catch((err) =>
          NamedError.Unknown.isInstance(err)
            ? Effect.fail(new SessionResumeFailedError({ message: err.data.message }))
            : Effect.fail(err),
        ),
      )
      return {
        messageID: result.messageID,
        format: result.format,
        messages: result.messages,
        dropped: result.dropped,
      }
    })

    return handlers.handle("import", doImport)
  }),
)
