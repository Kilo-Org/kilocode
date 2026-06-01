import { BackgroundProcess } from "@/kilocode/background-process"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/background-process"

export const BackgroundProcessPaths = {
  list: root,
  get: `${root}/:processID`,
  logs: `${root}/:processID/logs`,
  stop: `${root}/:processID/stop`,
  restart: `${root}/:processID/restart`,
  stopSession: `${root}/session/:sessionID/stop`,
} as const

export const Params = Schema.Struct({ processID: BackgroundProcess.ID })
export const SessionParams = Schema.Struct({ sessionID: SessionID })

export const BackgroundProcessApi = HttpApi.make("background-process")
  .add(
    HttpApiGroup.make("background-process")
      .add(
        HttpApiEndpoint.get("list", BackgroundProcessPaths.list, {
          success: described(Schema.Array(BackgroundProcess.Info), "List of background processes"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "backgroundProcess.list",
            summary: "List background processes",
            description: "List tracked background processes for the current instance.",
          }),
        ),
        HttpApiEndpoint.get("get", BackgroundProcessPaths.get, {
          params: { processID: BackgroundProcess.ID },
          success: described(BackgroundProcess.Info, "Background process info"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "backgroundProcess.get",
            summary: "Get background process",
            description: "Get status and retained output for one background process.",
          }),
        ),
        HttpApiEndpoint.get("logs", BackgroundProcessPaths.logs, {
          params: { processID: BackgroundProcess.ID },
          success: described(BackgroundProcess.Logs, "Background process logs"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "backgroundProcess.logs",
            summary: "Get background process logs",
            description: "Get the retained output tail for one background process.",
          }),
        ),
        HttpApiEndpoint.post("stop", BackgroundProcessPaths.stop, {
          params: { processID: BackgroundProcess.ID },
          success: described(BackgroundProcess.Info, "Stopped background process"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "backgroundProcess.stop",
            summary: "Stop background process",
            description: "Terminate a background process and its child process tree.",
          }),
        ),
        HttpApiEndpoint.post("restart", BackgroundProcessPaths.restart, {
          params: { processID: BackgroundProcess.ID },
          success: described(BackgroundProcess.Info, "Restarted background process"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "backgroundProcess.restart",
            summary: "Restart background process",
            description: "Stop and restart a background process with its original command.",
          }),
        ),
        HttpApiEndpoint.post("stopSession", BackgroundProcessPaths.stopSession, {
          params: { sessionID: SessionID },
          success: described(Schema.Boolean, "Stopped session background processes"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "backgroundProcess.stopSession",
            summary: "Stop session background processes",
            description: "Terminate and forget all background processes associated with one session.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "background-process",
          description: "Kilo background process routes.",
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
