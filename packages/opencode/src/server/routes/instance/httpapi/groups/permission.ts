import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { PermissionNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/permission"
const ReplyPayload = Schema.Struct({
  reply: Permission.Reply,
  message: Schema.optional(Schema.String),
})

// kilocode_change start
export const SaveAlwaysRulesBody = Schema.Struct({
  approvedAlways: Schema.Array(Schema.String).pipe(Schema.optional),
  deniedAlways: Schema.Array(Schema.String).pipe(Schema.optional),
})

export const AllowEverythingBody = Schema.Struct({
  enable: Schema.Boolean,
  requestID: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
})
// kilocode_change end

export const PermissionApi = HttpApi.make("permission")
  .add(
    HttpApiGroup.make("permission")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Permission.Request), "List of pending permissions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.list",
            summary: "List pending permissions",
            description: "Get all pending permission requests across all sessions.",
          }),
        ),
        HttpApiEndpoint.post("reply", `${root}/:requestID/reply`, {
          params: { requestID: PermissionID },
          query: WorkspaceRoutingQuery,
          payload: ReplyPayload,
          success: described(Schema.Boolean, "Permission processed successfully"),
          error: [HttpApiError.BadRequest, PermissionNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.reply",
            summary: "Respond to permission request",
            description: "Approve or deny a permission request from the AI assistant.",
          }),
        ),
        // kilocode_change start
        HttpApiEndpoint.post("saveAlwaysRules", `${root}/:requestID/always-rules`, {
          params: { requestID: PermissionID },
          query: WorkspaceRoutingQuery,
          payload: SaveAlwaysRulesBody,
          success: described(Schema.Boolean, "Always-rules saved"),
          error: [PermissionNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.saveAlwaysRules",
            summary: "Save always-allow/deny permission rules",
            description: "Save approved/denied always-rules for a pending permission request.",
          }),
        ),
        HttpApiEndpoint.post("allowEverything", `${root}/allow-everything`, {
          query: WorkspaceRoutingQuery,
          payload: AllowEverythingBody,
          success: described(Schema.Boolean, "Success"),
          error: [HttpApiError.BadRequest, PermissionNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.allowEverything",
            summary: "Allow everything",
            description: "Enable or disable allowing all permissions without prompts.",
          }),
        ),
        // kilocode_change end
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "permission",
          description: "Experimental HttpApi permission routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
