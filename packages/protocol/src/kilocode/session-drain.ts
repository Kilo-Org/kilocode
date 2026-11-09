import { Session } from "@opencode-ai/schema/session"
import { Token } from "@opencode-ai/schema/kilocode/session-drain"
import { optional } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { SessionNotFoundError } from "../errors"

export { Drained } from "@opencode-ai/schema/kilocode/session-drain"

export const drain = HttpApiEndpoint.post("session.drain", "/api/session/:sessionID/drain", {
  params: { sessionID: Session.ID },
  payload: Schema.Struct({ token: Token.pipe(optional) }),
  success: HttpApiSchema.NoContent,
  error: SessionNotFoundError,
}).annotateMerge(
  OpenApi.annotations({
    identifier: "v2.session.drain",
    summary: "Drain session work",
    description:
      "Wait until this process has no accepted intake, foreground execution, descendant execution, or related background work for the session. Does not start execution or wait for unrelated sessions. An optional token publishes a matching session.drained live event before the response. Cancelling the request does not cancel the work. Quiescence is process-local, not a guarantee against future work or successful output.",
  }),
)
