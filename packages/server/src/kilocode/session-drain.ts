import { Effect } from "effect"
import { HttpApiSchema } from "effect/unstable/httpapi"
import { EventV2 } from "@opencode-ai/core/event"
import type { SessionV2 } from "@opencode-ai/core/session"
import type { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionNotFoundError } from "@opencode-ai/protocol/errors"
import { Drained } from "@opencode-ai/protocol/kilocode/session-drain"

export const drain = (sessions: SessionV2.Interface, events: EventV2.Interface) =>
  Effect.fn(function* (ctx: { params: { sessionID: SessionSchema.ID }; payload: { readonly token?: string } }) {
    yield* sessions
      .drain(ctx.params.sessionID)
      .pipe(
        Effect.catchTag("Session.NotFoundError", (error) =>
          Effect.fail(
            new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }),
          ),
        ),
      )
    if (ctx.payload.token !== undefined) {
      yield* events.publish(Drained, { sessionID: ctx.params.sessionID, token: ctx.payload.token })
    }
    return HttpApiSchema.NoContent.make()
  })
