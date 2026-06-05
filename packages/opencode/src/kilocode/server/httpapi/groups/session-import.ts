import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/kilocode/session-import"

const ResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  id: Schema.String,
  skipped: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "KilocodeSessionImportResult" })

const ProjectSchema = Schema.Struct({
  id: Schema.String,
  worktree: Schema.String,
  vcs: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  iconUrl: Schema.optional(Schema.String),
  iconColor: Schema.optional(Schema.String),
  timeCreated: Schema.Finite,
  timeUpdated: Schema.Finite,
  timeInitialized: Schema.optional(Schema.Finite),
  sandboxes: Schema.Array(Schema.String),
  commands: Schema.optional(
    Schema.Struct({
      start: Schema.optional(Schema.String),
    }),
  ),
})

const SessionSchema = Schema.Struct({
  id: Schema.String,
  projectID: Schema.String,
  force: Schema.optional(Schema.Boolean),
  workspaceID: Schema.optional(Schema.String),
  parentID: Schema.optional(Schema.String),
  slug: Schema.String,
  directory: Schema.String,
  title: Schema.String,
  version: Schema.String,
  shareURL: Schema.optional(Schema.String),
  summary: Schema.optional(
    Schema.Struct({
      additions: Schema.Finite,
      deletions: Schema.Finite,
      files: Schema.Finite,
      diffs: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
    }),
  ),
  revert: Schema.optional(
    Schema.Struct({
      messageID: Schema.String,
      partID: Schema.optional(Schema.String),
      snapshot: Schema.optional(Schema.String),
      diff: Schema.optional(Schema.String),
    }),
  ),
  permission: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  timeCreated: Schema.Finite,
  timeUpdated: Schema.Finite,
  timeCompacting: Schema.optional(Schema.Finite),
  timeArchived: Schema.optional(Schema.Finite),
})

const UserMessageDataSchema = Schema.Struct({
  role: Schema.Literal("user"),
  time: Schema.Struct({
    created: Schema.Finite,
  }),
  agent: Schema.String,
  model: Schema.Struct({
    providerID: Schema.String,
    modelID: Schema.String,
  }),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
})

const AssistantMessageDataSchema = Schema.Struct({
  role: Schema.Literal("assistant"),
  time: Schema.Struct({
    created: Schema.Finite,
    completed: Schema.optional(Schema.Finite),
  }),
  parentID: Schema.String,
  modelID: Schema.String,
  providerID: Schema.String,
  mode: Schema.String,
  agent: Schema.String,
  path: Schema.Struct({
    cwd: Schema.String,
    root: Schema.String,
  }),
  summary: Schema.optional(Schema.Boolean),
  cost: Schema.Finite,
  tokens: Schema.Struct({
    total: Schema.optional(Schema.Finite),
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite,
    }),
  }),
  structured: Schema.optional(Schema.Unknown),
  variant: Schema.optional(Schema.String),
  finish: Schema.optional(Schema.String),
})

const MessageDataSchema = Schema.Union([UserMessageDataSchema, AssistantMessageDataSchema])

const TextPartDataSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  synthetic: Schema.optional(Schema.Boolean),
  ignored: Schema.optional(Schema.Boolean),
  time: Schema.optional(
    Schema.Struct({
      start: Schema.Finite,
      end: Schema.optional(Schema.Finite),
    }),
  ),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

const ReasoningPartDataSchema = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  time: Schema.Struct({
    start: Schema.Finite,
    end: Schema.optional(Schema.Finite),
  }),
})

const ToolStatePendingSchema = Schema.Struct({
  status: Schema.Literal("pending"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  raw: Schema.String,
})

const ToolStateRunningSchema = Schema.Struct({
  status: Schema.Literal("running"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  title: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  time: Schema.Struct({
    start: Schema.Finite,
  }),
})

const ToolStateCompletedSchema = Schema.Struct({
  status: Schema.Literal("completed"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  output: Schema.String,
  title: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  time: Schema.Struct({
    start: Schema.Finite,
    end: Schema.Finite,
    compacted: Schema.optional(Schema.Finite),
  }),
})

const ToolStateErrorSchema = Schema.Struct({
  status: Schema.Literal("error"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  error: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  time: Schema.Struct({
    start: Schema.Finite,
    end: Schema.Finite,
  }),
})

const ToolStateSchema = Schema.Union([
  ToolStatePendingSchema,
  ToolStateRunningSchema,
  ToolStateCompletedSchema,
  ToolStateErrorSchema,
])

const ToolPartDataSchema = Schema.Struct({
  type: Schema.Literal("tool"),
  callID: Schema.String,
  tool: Schema.String,
  state: ToolStateSchema,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

const PartDataSchema = Schema.Union([TextPartDataSchema, ReasoningPartDataSchema, ToolPartDataSchema])

const MessageSchema = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  timeCreated: Schema.Finite,
  data: MessageDataSchema,
})

const PartSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  sessionID: Schema.String,
  timeCreated: Schema.optional(Schema.Finite),
  data: PartDataSchema,
})

export const SessionImportPaths = {
  project: `${root}/project`,
  session: `${root}/session`,
  message: `${root}/message`,
  part: `${root}/part`,
} as const

export const SessionImportPayloads = {
  Project: ProjectSchema,
  Session: SessionSchema,
  Message: MessageSchema,
  Part: PartSchema,
} as const

export const SessionImportApi = HttpApi.make("session-import")
  .add(
    HttpApiGroup.make("session-import")
      .add(
        HttpApiEndpoint.post("project", SessionImportPaths.project, {
          query: WorkspaceRoutingQuery,
          payload: ProjectSchema,
          success: described(ResultSchema, "Project import result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kilocode.sessionImport.project",
            summary: "Insert project for session import",
            description: "Insert or update a project row used by legacy session import.",
          }),
        ),
        HttpApiEndpoint.post("session", SessionImportPaths.session, {
          query: WorkspaceRoutingQuery,
          payload: SessionSchema,
          success: described(ResultSchema, "Session import result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kilocode.sessionImport.session",
            summary: "Insert session for session import",
            description: "Insert or update a session row used by legacy session import.",
          }),
        ),
        HttpApiEndpoint.post("message", SessionImportPaths.message, {
          query: WorkspaceRoutingQuery,
          payload: MessageSchema,
          success: described(ResultSchema, "Message import result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kilocode.sessionImport.message",
            summary: "Insert message for session import",
            description: "Insert or update a message row used by legacy session import.",
          }),
        ),
        HttpApiEndpoint.post("part", SessionImportPaths.part, {
          query: WorkspaceRoutingQuery,
          payload: PartSchema,
          success: described(ResultSchema, "Part import result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kilocode.sessionImport.part",
            summary: "Insert part for session import",
            description: "Insert or update a part row used by legacy session import.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "session-import",
          description: "Kilo legacy session import routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "kilo HttpApi",
      version: "0.0.1",
      description: "Kilo HttpApi surface.",
    }),
  )
