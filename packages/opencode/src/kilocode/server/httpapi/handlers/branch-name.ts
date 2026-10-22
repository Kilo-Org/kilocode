import * as Log from "@opencode-ai/core/util/log"
import { generate, messages } from "@/kilocode/branch-name"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Cause, Effect, Option } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { BranchNamePayload } from "../groups/branch-name"

const log = Log.create({ service: "branch-name" })

export const branchNameHandlers = HttpApiBuilder.group(InstanceHttpApi, "branch-name", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service

    const handle = Effect.fn("BranchNameHttpApi.generate")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof BranchNamePayload.Type
    }) {
      const branch = yield* Effect.gen(function* () {
        const history = yield* session.messages({ sessionID: ctx.params.sessionID })
        return yield* generate({
          sessionID: ctx.params.sessionID,
          messages: messages(history, ctx.payload.prompt),
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
        })
      }).pipe(
        Effect.timeoutOption("10 seconds"),
        Effect.map(Option.getOrNull),
        Effect.catchCause((cause) => {
          log.error("generation failed", { error: Cause.pretty(cause) })
          return Effect.succeed(null)
        }),
      )
      return { branch }
    })

    return handlers.handle("generate", handle)
  }),
)
