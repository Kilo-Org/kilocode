import { InteractiveTerminal } from "@/kilocode/interactive-terminal"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/interactive-terminal"

export const InteractiveTerminalPaths = {
  list: root,
  get: `${root}/:terminalID`,
  write: `${root}/:terminalID/input`,
  resize: `${root}/:terminalID/resize`,
  close: `${root}/:terminalID/close`,
} as const

export const InteractiveTerminalApi = HttpApi.make("interactive-terminal")
  .add(
    HttpApiGroup.make("interactive-terminal")
      .add(
        HttpApiEndpoint.get("list", InteractiveTerminalPaths.list, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(InteractiveTerminal.Snapshot), "List of interactive terminals"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "interactiveTerminal.list",
            summary: "List interactive terminals",
            description: "List active human-driven terminal sessions for the current instance.",
          }),
        ),
        HttpApiEndpoint.get("get", InteractiveTerminalPaths.get, {
          params: { terminalID: InteractiveTerminal.ID },
          query: WorkspaceRoutingQuery,
          success: described(InteractiveTerminal.Snapshot, "Interactive terminal snapshot"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "interactiveTerminal.get",
            summary: "Get interactive terminal",
            description: "Get metadata and retained output for an active interactive terminal.",
          }),
        ),
        HttpApiEndpoint.post("write", InteractiveTerminalPaths.write, {
          params: { terminalID: InteractiveTerminal.ID },
          query: WorkspaceRoutingQuery,
          payload: InteractiveTerminal.WriteInput,
          success: described(Schema.Boolean, "Input written"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "interactiveTerminal.write",
            summary: "Write interactive terminal input",
            description: "Send raw keyboard input to an active interactive terminal.",
          }),
        ),
        HttpApiEndpoint.post("resize", InteractiveTerminalPaths.resize, {
          params: { terminalID: InteractiveTerminal.ID },
          query: WorkspaceRoutingQuery,
          payload: InteractiveTerminal.ResizeInput,
          success: described(Schema.Boolean, "Terminal resized"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "interactiveTerminal.resize",
            summary: "Resize interactive terminal",
            description: "Resize an active interactive terminal's PTY.",
          }),
        ),
        HttpApiEndpoint.post("close", InteractiveTerminalPaths.close, {
          params: { terminalID: InteractiveTerminal.ID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Terminal closed"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "interactiveTerminal.close",
            summary: "Close interactive terminal",
            description: "Terminate an active interactive terminal and unblock its tool call.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "interactive-terminal",
          description: "Kilo human-driven interactive terminal routes.",
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
