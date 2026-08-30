import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

// Routes for migrating work into Kilo from another coding agent. Today that is
// Claude Code / OpenAI Codex session transcripts; the `migrate` group is the
// home for any future "bring your existing X into Kilo" route.
const root = "/kilocode/migrate/sessions"

export const MigrateSessionsPayload = Schema.Struct({
  sessionID: Schema.String.annotate({
    description: "Target Kilo session. Must be empty (no existing messages).",
  }),
  content: Schema.String.annotate({
    description: "Raw JSONL transcript content (Claude Code or OpenAI Codex, Anthropic message format).",
  }),
  agent: Schema.optional(Schema.String).annotate({
    description: "Agent name to attribute the migrated messages to. Defaults to the default agent.",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model reference (providerID/modelID). Defaults to the agent or provider default.",
  }),
})

const MigrateSessionsResult = Schema.Struct({
  messageID: Schema.String.annotate({ description: "Final assistant message written by the migration." }),
  format: Schema.Literals(["claude", "codex"]).annotate({ description: "Detected transcript format." }),
  messages: Schema.Finite.annotate({ description: "Number of messages written to the session." }),
  dropped: Schema.Array(Schema.String).annotate({
    description: "Human-readable reasons for content that could not be migrated.",
  }),
}).annotate({ identifier: "KilocodeMigrateSessionsResult" })

const MigrateSessionsModel = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
}).annotate({ identifier: "KilocodeMigrateSessionsModel" })

export const MigrateSessionsDiscoverPayload = Schema.Struct({
  cwd: Schema.optional(Schema.String).annotate({
    description: "Directory whose external sessions to enumerate. Defaults to the current instance directory.",
  }),
  formats: Schema.optional(Schema.Array(Schema.Literals(["claude", "codex"]))).annotate({
    description: "Transcript formats to enumerate. Defaults to both.",
  }),
})

const MigrateSessionsDiscovered = Schema.Struct({
  id: Schema.String.annotate({ description: "Session UUID parsed from the transcript filename." }),
  format: Schema.Literals(["claude", "codex"]).annotate({ description: "Detected transcript format." }),
  path: Schema.String.annotate({ description: "Absolute path to the JSONL transcript on the CLI host." }),
  mtime: Schema.Finite.annotate({ description: "Last-modified time (epoch ms)." }),
  version: Schema.Finite.annotate({ description: "Source harness major version." }),
  title: Schema.optional(Schema.String).annotate({ description: "First user message text (single line, clamped)." }),
  messages: Schema.Finite.annotate({ description: "Number of user + assistant steps in the transcript." }),
  model: Schema.optional(MigrateSessionsModel).annotate({
    description: "Source model reference, if the transcript records one.",
  }),
}).annotate({ identifier: "KilocodeMigrateSessionsDiscovered" })

const MigrateSessionsDiscoverResult = Schema.Struct({
  sessions: Schema.Array(MigrateSessionsDiscovered).annotate({
    description: "Discovered migratable sessions, most recently modified first.",
  }),
  dropped: Schema.Array(Schema.String).annotate({
    description: "Human-readable reasons for transcripts that were found but could not be previewed.",
  }),
}).annotate({ identifier: "KilocodeMigrateSessionsDiscoverResult" })

export class MigrateFailedError extends Schema.ErrorClass<MigrateFailedError>("MigrateFailedError")(
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

export const MigrateApi = HttpApi.make("migrate").add(
  HttpApiGroup.make("migrate")
    .add(
      HttpApiEndpoint.post("sessions", root, {
        query: WorkspaceRoutingQuery,
        payload: MigrateSessionsPayload,
        success: described(MigrateSessionsResult, "Session migration result"),
        error: [HttpApiError.BadRequest, MigrateFailedError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "kilocode.migrate.sessions",
          summary: "Migrate an external session transcript into Kilo",
          description:
            "Parse a Claude Code or OpenAI Codex JSONL transcript and migrate it into an empty Kilo session.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("discover", `${root}/discover`, {
        query: WorkspaceRoutingQuery,
        payload: MigrateSessionsDiscoverPayload,
        success: described(MigrateSessionsDiscoverResult, "Discovered migratable sessions"),
        error: [HttpApiError.BadRequest, MigrateFailedError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "kilocode.migrate.discover",
          summary: "Discover migratable external session transcripts",
          description:
            "Enumerate Claude Code and OpenAI Codex JSONL transcripts for a directory and preview each so callers can list migratable sessions before migrating. Read-only; writes nothing.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "migrate",
        description: "Kilo routes for migrating sessions from other coding agents into Kilo.",
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
