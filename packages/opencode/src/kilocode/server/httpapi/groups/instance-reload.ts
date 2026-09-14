import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { ConflictError } from "@/server/routes/instance/httpapi/errors"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const ReloadPaths = {
  reload: "/instance/reload",
} as const

export const InstanceReloadApi = HttpApi.make("instance-reload")
  .add(
    HttpApiGroup.make("instance-reload")
      .add(
        HttpApiEndpoint.post("reload", ReloadPaths.reload, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Instance reloaded"),
          error: ConflictError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "instance.reload",
            summary: "Reload project",
            description:
              "Atomically dispose and reboot every loaded instance of the project, reloading config, skills, agents, commands, and MCP prompts from disk. Returns 409 if any session in the project is actively running.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "instance-reload",
          description: "Kilo instance reload route.",
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
