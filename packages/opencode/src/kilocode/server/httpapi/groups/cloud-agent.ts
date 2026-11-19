import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@/server/routes/instance/httpapi/errors"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"

export const CloudAgentApi = HttpApi.make("cloud-agent").add(
  HttpApiGroup.make("cloudAgent")
    .add(
      HttpApiEndpoint.get("systemEvents", "/cloud-agent/event", {
        query: WorkspaceRoutingQuery,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "cloudAgent.systemEvents",
          summary: "Subscribe to Cloud Agent system events",
          description: "Read preparation and sandbox status events through an opaque hosted attachment.",
        }),
      ),
    )
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization)
    .annotateMerge(OpenApi.annotations({ title: "cloudAgent", description: "Hosted Cloud Agent system events." })),
)
