import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as SandboxActivation from "@/kilocode/sandbox/activation"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import * as SessionError from "@/server/routes/instance/httpapi/handlers/session-errors"
import { BackgroundProcess } from "@/kilocode/background-process"
import { InteractiveTerminal } from "@/kilocode/interactive-terminal"
import { Service as Notebook } from "@/kilocode/notebook/service"
import { InvalidRequestError } from "@/server/routes/instance/httpapi/errors"

export const sandboxHandlers = HttpApiBuilder.group(InstanceHttpApi, "sandbox", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const notebook = yield* Notebook
    const exists = (sessionID: SessionID) => SessionError.mapStorageNotFound(session.get(sessionID))
    const inactive = (sessionID: SessionID, family: readonly SandboxPolicy.Target[]) =>
      Effect.gen(function* () {
        if (!(yield* SandboxActivation.idle(sessionID, family))) {
          yield* new InvalidRequestError({
            message: "Stop the active session and its subagents before enabling sandbox confinement",
          })
        }
      })
    return handlers
      .handle("support", () => SandboxPolicy.configuredSupport())
      .handle("status", (ctx: { params: { sessionID: SessionID } }) =>
        exists(ctx.params.sessionID).pipe(Effect.andThen(SandboxPolicy.status(ctx.params.sessionID))),
      )
      .handle("toggle", (ctx: { params: { sessionID: SessionID } }) =>
        SandboxPolicy.toggleGuarded(
          ctx.params.sessionID,
          (enabling, family) =>
            exists(ctx.params.sessionID).pipe(
              Effect.andThen(
                enabling
                  ? Effect.gen(function* () {
                      yield* inactive(ctx.params.sessionID, family)
                      yield* Effect.all(
                        [
                          Effect.promise(() => BackgroundProcess.stopSession(ctx.params.sessionID)),
                          Effect.promise(() => InteractiveTerminal.stopSession(ctx.params.sessionID)),
                          notebook.cancelSession(ctx.params.sessionID),
                        ],
                        { discard: true },
                      )
                    })
                  : Effect.void,
              ),
            ),
          SandboxActivation.family(ctx.params.sessionID),
          (family) =>
            exists(ctx.params.sessionID).pipe(Effect.andThen(inactive(ctx.params.sessionID, family))),
        ),
      )
  }),
)
