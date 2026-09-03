import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ReadyStatus, Status } from "@/kilocode/anaconda-desktop/domain"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/kilocode/anaconda-desktop"

export const AnacondaDesktopPaths = {
  status: `${root}/status`,
  open: `${root}/open`,
  sync: `${root}/sync`,
} as const

export const AnacondaDesktopSyncPayload = Schema.Struct({
  acknowledgeToolLimitations: Schema.optional(Schema.Boolean),
})

export class AnacondaDesktopConflictError extends Schema.ErrorClass<AnacondaDesktopConflictError>(
  "AnacondaDesktopConflictError",
)(
  {
    code: Schema.Literals(["unsupported-platform", "not-installed", "not-ready", "acknowledgement-required"]),
    message: Schema.String,
    status: Schema.optional(Status),
  },
  { httpApiStatus: 409 },
) {}

export class AnacondaDesktopOperationError extends Schema.ErrorClass<AnacondaDesktopOperationError>(
  "AnacondaDesktopOperationError",
)(
  {
    operation: Schema.Literals(["open", "sync"]),
    message: Schema.String,
  },
  { httpApiStatus: 500 },
) {}

export const AnacondaDesktopApi = HttpApi.make("anaconda-desktop")
  .add(
    HttpApiGroup.make("anaconda-desktop")
      .add(
        HttpApiEndpoint.get("status", AnacondaDesktopPaths.status, {
          query: WorkspaceRoutingQuery,
          success: described(Status, "Anaconda Desktop setup status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "anacondaDesktop.status",
            summary: "Get Anaconda Desktop setup status",
            description: "Discover the locally installed Anaconda Desktop and its active inference server.",
          }),
        ),
        HttpApiEndpoint.post("open", AnacondaDesktopPaths.open, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Literal(true), "Anaconda Desktop opened"),
          error: [AnacondaDesktopConflictError, AnacondaDesktopOperationError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "anacondaDesktop.open",
            summary: "Open Anaconda Desktop",
            description: "Open the locally installed Anaconda Desktop application.",
          }),
        ),
        HttpApiEndpoint.post("sync", AnacondaDesktopPaths.sync, {
          query: WorkspaceRoutingQuery,
          payload: AnacondaDesktopSyncPayload,
          success: described(ReadyStatus, "Anaconda Desktop connection synchronized"),
          error: [AnacondaDesktopConflictError, AnacondaDesktopOperationError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "anacondaDesktop.sync",
            summary: "Synchronize Anaconda Desktop provider",
            description:
              "Discover the active local inference server and replace Kilo provider authentication metadata.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "anaconda-desktop",
          description: "Local Anaconda Desktop provider setup routes.",
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
