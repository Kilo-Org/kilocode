import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/kilocode/session-resume"

export const SessionResumePayload = Schema.Struct({
  sessionID: Schema.String.annotate({
    description: "Target Kilo session. Must be empty (no existing messages).",
  }),
  content: Schema.String.annotate({
    description: "Raw JSONL transcript content (Claude Code or OpenAI Codex, Anthropic message format).",
  }),
  agent: Schema.optional(Schema.String).annotate({
    description: "Agent name to attribute the imported messages to. Defaults to the default agent.",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model reference (providerID/modelID). Defaults to the agent or provider default.",
  }),
})

const SessionResumeResult = Schema.Struct({
  messageID: Schema.String.annotate({ description: "Final assistant message written by the import." }),
  format: Schema.Literals(["claude", "codex"]).annotate({ description: "Detected transcript format." }),
  messages: Schema.Finite.annotate({ description: "Number of messages written to the session." }),
  dropped: Schema.Array(Schema.String).annotate({
    description: "Human-readable reasons for content that could not be imported.",
  }),
}).annotate({ identifier: "KilocodeSessionResumeResult" })

export class SessionResumeFailedError extends Schema.ErrorClass<SessionResumeFailedError>("SessionResumeFailedError")(
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

export const SessionResumeApi = HttpApi.make("session-resume").add(
  HttpApiGroup.make("session-resume")
    .add(
      HttpApiEndpoint.post("import", root, {
        query: WorkspaceRoutingQuery,
        payload: SessionResumePayload,
        success: described(SessionResumeResult, "Session import result"),
        error: [HttpApiError.BadRequest, SessionResumeFailedError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "kilocode.sessionResume.import",
          summary: "Import an external session transcript",
          description:
            "Parse a Claude Code or OpenAI Codex JSONL transcript and import it into an empty Kilo session.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "session-resume",
        description: "Kilo external session transcript import routes.",
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
