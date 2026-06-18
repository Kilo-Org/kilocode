import { Schema } from "effect"
import { MemorySchema } from "@kilocode/kilo-memory/schema"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQueryFields,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { MemoryApiClientError, MemoryApiServerError } from "@/kilocode/memory/errors" // kilocode_change

const MemoryErrors = [MemoryApiClientError, MemoryApiServerError] as const // kilocode_change

const root = "/memory"

const Source = Schema.Literals(MemorySchema.Sources)
const Section = Schema.String.check(Schema.isMaxLength(80), Schema.isPattern(/^[^\x00-\x1f\x7f]*$/))
export const MemoryQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
})

const Capture = Schema.Struct({
  mode: Schema.Literal("selective"),
  turnClose: Schema.Boolean,
  explicit: Schema.Boolean,
  maxOpsPerRun: Schema.Finite,
  minIntervalMs: Schema.Finite,
  timeoutMs: Schema.Finite,
})

const Limits = Schema.Struct({
  maxProjectIndexBytes: Schema.Finite,
  maxSessionFiles: Schema.Finite,
  maxRecentSessions: Schema.Finite,
  maxConsolidationInputBytes: Schema.Finite,
  maxLineChars: Schema.Finite,
  maxSessionLineChars: Schema.Finite,
})

const Stats = Schema.Struct({
  lastInjectedAt: Schema.Finite,
  lastInjectedBytes: Schema.Finite,
  lastInjectedTokens: Schema.Finite,
  lastInjectedSessionID: Schema.String,
  lastConsolidatedAt: Schema.Finite,
  lastConsolidationCost: Schema.Finite,
  lastConsolidationTokens: Schema.Finite,
  lastOperationCount: Schema.Finite,
})

const State = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  scope: Schema.Literal("project"),
  autoInject: Schema.Boolean,
  autoConsolidate: Schema.Boolean,
  capture: Capture,
  limits: Limits,
  stats: Stats,
})

const Index = Schema.Struct({
  text: Schema.String,
  bytes: Schema.Finite,
  tokens: Schema.Finite,
  truncated: Schema.Boolean,
})

const Status = Schema.Struct({
  root: Schema.String,
  state: State,
  exists: Schema.Struct({
    state: Schema.Boolean,
    index: Schema.Boolean,
  }),
  index: Schema.Struct({
    bytes: Schema.Finite,
    estimatedTokens: Schema.Finite,
    preview: Schema.String,
  }),
})

const Show = Schema.Struct({
  root: Schema.String,
  state: State,
  sources: Schema.Struct({
    project: Schema.String,
    environment: Schema.String,
    corrections: Schema.String,
  }),
  index: Schema.String,
  items: Schema.String,
  changes: Schema.String,
  decisions: Schema.String,
})

const Enable = Schema.Struct({
  root: Schema.String,
  state: State,
  index: Index,
})

const Disable = Schema.Struct({
  root: Schema.String,
  state: State,
})

const Skip = Schema.Struct({
  reason: Schema.Literals(["self_referential", "out_of_scope"]),
  text: Schema.optional(Schema.String),
})

const Operation = Schema.Struct({
  operationCount: Schema.Finite,
  added: Schema.Finite,
  removed: Schema.Finite,
  skipped: Schema.Array(Skip),
  index: Index,
})

const Purge = Schema.Struct({
  root: Schema.String,
  purged: Schema.Boolean,
})

export const MemoryRememberPayload = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1)),
  key: Schema.optional(Schema.String),
  file: Schema.optional(Source),
  section: Schema.optional(Section),
  sessionID: Schema.optional(Schema.String),
})

export const MemoryCorrectPayload = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1)),
  key: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
})

export const MemoryForgetPayload = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1)),
  sessionID: Schema.optional(Schema.String),
})

export const MemoryConfigurePayload = Schema.Struct({
  autoConsolidate: Schema.optional(Schema.Boolean),
})

export const MemoryPurgePayload = Schema.Struct({
  confirm: Schema.Literal(true),
})

export const MemoryPaths = {
  status: `${root}/status`,
  show: `${root}/show`,
  enable: `${root}/enable`,
  disable: `${root}/disable`,
  configure: `${root}/configure`,
  rebuild: `${root}/rebuild`,
  remember: `${root}/remember`,
  correct: `${root}/correct`,
  forget: `${root}/forget`,
  purge: `${root}/purge`,
} as const

export const MemoryApi = HttpApi.make("memory")
  .add(
    HttpApiGroup.make("memory")
      .add(
        HttpApiEndpoint.get("status", MemoryPaths.status, {
          query: MemoryQuery,
          success: described(Status, "Memory status"),
          error: MemoryErrors, // kilocode_change
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.status",
            summary: "Get memory status",
            description: "Return memory state, index preview, and token estimate for the active workspace.",
          }),
        ),
        HttpApiEndpoint.get("show", MemoryPaths.show, {
          query: MemoryQuery,
          success: described(Show, "Memory source and index"),
          error: MemoryErrors, // kilocode_change
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.show",
            summary: "Show memory",
            description:
              "Return source memory files, generated index, recent decision summary, and memory save decisions.",
          }),
        ),
        HttpApiEndpoint.post("enable", MemoryPaths.enable, {
          query: MemoryQuery,
          success: described(Enable, "Memory enabled"),
          error: MemoryErrors, // kilocode_change
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.enable",
            summary: "Enable memory",
            description: "Scaffold and enable project memory for the active workspace.",
          }),
        ),
        HttpApiEndpoint.post("disable", MemoryPaths.disable, {
          query: MemoryQuery,
          success: described(Disable, "Memory disabled"),
          error: MemoryErrors, // kilocode_change
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.disable",
            summary: "Disable memory",
            description: "Disable project memory without deleting local memory files.",
          }),
        ),
        HttpApiEndpoint.post("configure", MemoryPaths.configure, {
          query: MemoryQuery,
          payload: MemoryConfigurePayload,
          success: described(Disable, "Memory configured"),
          error: MemoryErrors, // kilocode_change
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.configure",
            summary: "Configure memory",
            description: "Update project memory settings such as automatic project fact capture.",
          }),
        ),
        HttpApiEndpoint.post("rebuild", MemoryPaths.rebuild, {
          query: MemoryQuery,
          success: described(Enable, "Memory rebuilt"),
          error: MemoryErrors, // kilocode_change
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.rebuild",
            summary: "Rebuild memory index",
            description: "Regenerate index.kmem from source memory files.",
          }),
        ),
        HttpApiEndpoint.post("remember", MemoryPaths.remember, {
          query: MemoryQuery,
          payload: MemoryRememberPayload,
          success: described(Operation, "Memory operation result"),
          error: MemoryErrors, // kilocode_change
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.remember",
            summary: "Remember text",
            description: "Persist explicit user-provided memory text through the deterministic operation pipeline.",
          }),
        ),
        HttpApiEndpoint.post("correct", MemoryPaths.correct, {
          query: MemoryQuery,
          payload: MemoryCorrectPayload,
          success: described(Operation, "Memory correction result"),
          error: MemoryErrors, // kilocode_change
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.correct",
            summary: "Remember correction",
            description: "Persist explicit corrective memory under corrections.md.",
          }),
        ),
        HttpApiEndpoint.post("forget", MemoryPaths.forget, {
          query: MemoryQuery,
          payload: MemoryForgetPayload,
          success: described(Operation, "Memory forget result"),
          error: MemoryErrors, // kilocode_change
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.forget",
            summary: "Forget memory",
            description: "Remove memory lines by exact key, id, or normalized key text and rebuild the index.",
          }),
        ),
        HttpApiEndpoint.post("purge", MemoryPaths.purge, {
          query: MemoryQuery,
          payload: MemoryPurgePayload,
          success: described(Purge, "Memory purged"),
          error: MemoryErrors, // kilocode_change
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.purge",
            summary: "Purge memory",
            description: "Delete all project memory files for the active workspace.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "memory",
          description: "Kilo memory routes.",
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
