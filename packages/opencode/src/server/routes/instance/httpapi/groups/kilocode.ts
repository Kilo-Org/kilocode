// kilocode_change - new file
import { AgentManagerInspectBridge } from "@/kilocode/agent-manager/inspect"
import { AgentManagerControlBridge } from "@/kilocode/agent-manager/control"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/kilocode"

export const KilocodePaths = {
  agentManagerInspectRespond: `${root}/agent-manager/inspect/respond`,
  agentManagerControlRespond: `${root}/agent-manager/control/respond`,
} as const

export const KilocodeApi = HttpApi.make("kilocode").add(
  HttpApiGroup.make("kilocode")
    .add(
      HttpApiEndpoint.post("agentManagerControlRespond", KilocodePaths.agentManagerControlRespond, {
        payload: AgentManagerControlBridge.Response,
        success: described(Schema.Boolean, "Control response accepted"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "kilocode.agentManager.control.respond",
          summary: "Respond to Agent Manager control",
          description: "Internal extension bridge for Agent Manager write/control requests.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("agentManagerInspectRespond", KilocodePaths.agentManagerInspectRespond, {
        payload: AgentManagerInspectBridge.Response,
        success: described(Schema.Boolean, "Inspect response accepted"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "kilocode.agentManager.inspect.respond",
          summary: "Respond to Agent Manager inspect",
          description: "Internal extension bridge for read-only Agent Manager inspect requests.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "kilocode", description: "Kilo-specific instance routes." }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
