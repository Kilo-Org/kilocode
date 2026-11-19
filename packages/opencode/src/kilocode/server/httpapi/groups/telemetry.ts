import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
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

export const TelemetryLevelPayload = Schema.Struct({
  enabled: Schema.Boolean,
})

export const TelemetryLevelResult = Schema.Struct({
  enabled: Schema.Boolean,
})

export const TelemetryPaths = {
  capture: `${root}/capture`,
  setEnabled: `${root}/setEnabled`,
  level: `${root}/level`,
} as const

export const TelemetryApi = HttpApi.make("telemetry")
  .add(
    HttpApiGroup.make("telemetry")
      .add(
        HttpApiEndpoint.post("capture", TelemetryPaths.capture, {
          query: WorkspaceRoutingQuery,
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
          query: WorkspaceRoutingQuery,
          payload: TelemetrySetEnabledPayload,
          success: described(Schema.Boolean, "State updated"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "telemetry.setEnabled",
            summary: "Set host telemetry permission",
            description:
              "Apply the host editor's telemetry permission at runtime without changing config. This cannot override a config or environment opt-out. Use telemetry.setLevel for the Kilo preference.",
          }),
        ),
        HttpApiEndpoint.get("level", TelemetryPaths.level, {
          query: WorkspaceRoutingQuery,
          success: described(TelemetryLevelResult, "Effective telemetry level"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "telemetry.level",
            summary: "Get effective telemetry level",
            description: "Read whether global Kilo config, the host editor, and the environment all allow telemetry.",
          }),
        ),
        HttpApiEndpoint.post("setLevel", TelemetryPaths.level, {
          query: WorkspaceRoutingQuery,
          payload: TelemetryLevelPayload,
          success: described(TelemetryLevelResult, "Effective telemetry level after saving the preference"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "telemetry.setLevel",
            summary: "Save the Kilo telemetry preference",
            description:
              "Persist experimental.openTelemetry to the global Kilo config and apply it to the running telemetry client. Return the effective level, which can still be off due to a host or environment opt-out.",
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
