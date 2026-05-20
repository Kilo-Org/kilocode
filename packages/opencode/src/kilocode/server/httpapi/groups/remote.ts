import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/remote"

export const RemoteStatus = Schema.Struct({
  enabled: Schema.Boolean,
  connected: Schema.Boolean,
})

export const RemotePaths = {
  enable: `${root}/enable`,
  disable: `${root}/disable`,
  status: `${root}/status`,
} as const

export const RemoteApi = HttpApi.make("remote")
  .add(
    HttpApiGroup.make("remote")
      .add(
        HttpApiEndpoint.post("enable", RemotePaths.enable, {
          success: described(RemoteStatus, "Remote connection enabled"),
          error: HttpApiError.Unauthorized,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "remote.enable",
            summary: "Enable remote connection",
            description: "Enable WebSocket connection to UserConnectionDO for real-time session relay and commands.",
          }),
        ),
        HttpApiEndpoint.post("disable", RemotePaths.disable, {
          success: described(RemoteStatus, "Remote connection disabled"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "remote.disable",
            summary: "Disable remote connection",
            description: "Close the remote WebSocket connection to UserConnectionDO.",
          }),
        ),
        HttpApiEndpoint.get("status", RemotePaths.status, {
          success: described(RemoteStatus, "Remote connection status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "remote.status",
            summary: "Get remote connection status",
            description: "Get the current state of the remote WebSocket connection.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "remote",
          description: "Kilo remote connection routes.",
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
