import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { SessionID } from "@/session/schema"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { ApiNotFoundError } from "@/server/routes/instance/httpapi/errors"

const root = "/session/:sessionID/sandbox"

export const SandboxStatus = Schema.Struct({
  directory: Schema.String,
  enabled: Schema.Boolean,
  available: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  version: Schema.Int,
})

export const SandboxSupport = Schema.Struct({
  available: Schema.Boolean,
  reason: Schema.optional(Schema.String),
})

export const SandboxApi = HttpApi.make("sandbox")
  .add(
    HttpApiGroup.make("sandbox")
      .add(
        HttpApiEndpoint.get("support", "/sandbox/support", {
          query: WorkspaceRoutingQuery,
          success: described(SandboxSupport, "Sandbox backend support"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sandbox.support",
            summary: "Get sandbox backend support",
            description: "Get sandbox backend availability without creating a session.",
          }),
        ),
        HttpApiEndpoint.get("status", root, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(SandboxStatus, "Session sandbox status"),
          error: ApiNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sandbox.status",
            summary: "Get session sandbox status",
            description: "Get the effective sandbox state for one session.",
          }),
        ),
        HttpApiEndpoint.post("toggle", `${root}/toggle`, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(SandboxStatus, "Updated session sandbox status"),
          error: ApiNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sandbox.toggle",
            summary: "Toggle session sandbox",
            description: "Toggle and persist the sandbox state for one session.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "sandbox", description: "Kilo session sandbox routes." }))
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
