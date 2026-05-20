import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/telemetry"

export const TelemetryCapturePayload = Schema.Struct({
  event: Schema.String.annotate({ description: "Event name" }),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Event properties",
  }),
})

export const TelemetrySetEnabledPayload = Schema.Struct({
  enabled: Schema.Boolean,
})

export const TelemetryPaths = {
  capture: `${root}/capture`,
  setEnabled: `${root}/setEnabled`,
} as const

export const TelemetryApi = HttpApi.make("telemetry")
  .add(
    HttpApiGroup.make("telemetry")
      .add(
        HttpApiEndpoint.post("capture", TelemetryPaths.capture, {
          payload: TelemetryCapturePayload,
          success: described(Schema.Boolean, "Event captured"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "telemetry.capture",
            summary: "Capture telemetry event",
            description: "Forward a telemetry event to PostHog via kilo-telemetry.",
          }),
        ),
        HttpApiEndpoint.post("setEnabled", TelemetryPaths.setEnabled, {
          payload: TelemetrySetEnabledPayload,
          success: described(Schema.Boolean, "State updated"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "telemetry.setEnabled",
            summary: "Set PostHog telemetry enabled state",
            description:
              "Update the PostHog client's opt-in/out state at runtime. The CLI reads KILO_TELEMETRY_LEVEL once at spawn — this route lets clients (e.g. the VS Code extension) propagate runtime telemetry consent changes.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "telemetry",
          description: "Kilo telemetry routes.",
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
