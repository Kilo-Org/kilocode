import * as Log from "@opencode-ai/core/util/log"
import { Database } from "@opencode-ai/core/database/database"
import { Config } from "@/config/config"
import { KiloHookGit } from "@/kilocode/hooks/git"
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
    const config = yield* Config.Service
    const database = yield* Database.Service

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
      // BranchName hooks run outside the generation timeout, with their own (10 s by default).
      if (branch === null) return { branch }
      return {
        branch: yield* KiloHookGit.branch({
          sessionID: ctx.params.sessionID,
          branch,
          prompt: ctx.payload.prompt,
          sessions: session,
          config,
          database,
        }),
      }
    })

    return handlers.handle("generate", handle)
  }),
)
