import { Provider } from "@/provider/provider"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/provider/disabled"

export const DisabledProvidersList = Schema.Array(Provider.Info)
export type DisabledProvidersList = Schema.Schema.Type<typeof DisabledProvidersList>

export const DisabledProvidersApi = HttpApi.make("disabled-providers")
  .add(
    HttpApiGroup.make("disabled-providers")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(DisabledProvidersList, "Providers hidden by disabled_providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "disabledProviders.list",
            summary: "List disabled providers",
            description: "List providers hidden by the disabled_providers config so the settings UI can re-enable them.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "disabled-providers",
          description: "Kilo-only route that exposes providers hidden via disabled_providers.",
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
