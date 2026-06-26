import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import * as SessionError from "@/server/routes/instance/httpapi/handlers/session-errors"

export const sandboxHandlers = HttpApiBuilder.group(InstanceHttpApi, "sandbox", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const exists = (sessionID: SessionID) => SessionError.mapStorageNotFound(session.get(sessionID))
    return handlers
      .handle("support", () => SandboxPolicy.configuredSupport())
      .handle("status", (ctx: { params: { sessionID: SessionID } }) =>
        exists(ctx.params.sessionID).pipe(Effect.andThen(SandboxPolicy.status(ctx.params.sessionID))),
      )
      .handle("toggle", (ctx: { params: { sessionID: SessionID } }) =>
        SandboxPolicy.toggleGuarded(ctx.params.sessionID, exists(ctx.params.sessionID)),
      )
  }),
)
