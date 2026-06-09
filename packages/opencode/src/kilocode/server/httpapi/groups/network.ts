import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { QuestionID } from "@/question/schema"
import { SessionNetwork } from "@/session/network"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/network"

export const NetworkPaths = {
  list: root,
  reply: `${root}/:requestID/reply`,
  reject: `${root}/:requestID/reject`,
} as const

export const NetworkApi = HttpApi.make("network")
  .add(
    HttpApiGroup.make("network")
      .add(
        HttpApiEndpoint.get("list", NetworkPaths.list, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(SessionNetwork.Wait), "List of pending network reconnect requests"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "network.list",
            summary: "List pending network waits",
            description: "Get all pending network reconnect requests across all sessions.",
          }),
        ),
        HttpApiEndpoint.post("reply", NetworkPaths.reply, {
          params: { requestID: QuestionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Network wait resumed successfully"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "network.reply",
            summary: "Resume after network wait",
            description: "Resume a pending session after reconnecting network-dependent services.",
          }),
        ),
        HttpApiEndpoint.post("reject", NetworkPaths.reject, {
          params: { requestID: QuestionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Network wait rejected successfully"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "network.reject",
            summary: "Reject network resume request",
            description: "Stop a pending session instead of resuming after network reconnect.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "network",
          description: "Kilo network routes.",
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
