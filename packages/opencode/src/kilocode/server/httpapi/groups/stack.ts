import { Stack } from "@/kilocode/stack/schema"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const StackCatalogResponse = Stack.CatalogResponse.annotate({ identifier: "StackCatalogResponse" })
export const StackStateResponse = Stack.StateResponse.annotate({ identifier: "StackStateResponse" })
export const StackPreviewInput = Stack.PreviewInput.annotate({ identifier: "StackPreviewInput" })
export const StackPreviewResponse = Stack.PreviewResponse.annotate({ identifier: "StackPreviewResponse" })
export const StackApplyInput = Stack.ApplyInput.annotate({ identifier: "StackApplyInput" })
export const StackApplyResponse = Stack.ApplyResponse.annotate({ identifier: "StackApplyResponse" })
export const StackDetectionResponse = Stack.DetectionResponse.annotate({ identifier: "StackDetectionResponse" })

export const StackApiMessages = {
  invalidConfig: "Project Stack configuration is invalid or unavailable.",
  invalidDraft: "Stack selection is invalid.",
  stale: "Stack preview is stale. Refresh and review it again.",
  missing: "One or more selected resources are unavailable in Marketplace.",
  unavailable: "Marketplace is unavailable.",
  apply: "Stack changes could not be applied.",
} as const

export class StackInvalidConfigApiError extends Schema.ErrorClass<StackInvalidConfigApiError>(
  "StackInvalidConfigError",
)(
  {
    code: Schema.Literal("invalid_config"),
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class StackInvalidDraftApiError extends Schema.ErrorClass<StackInvalidDraftApiError>("StackInvalidDraftError")(
  {
    code: Schema.Literal("invalid_draft"),
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class StackStalePlanApiError extends Schema.ErrorClass<StackStalePlanApiError>("StackStalePlanError")(
  {
    code: Schema.Literal("stale_plan"),
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class StackMissingResourceApiError extends Schema.ErrorClass<StackMissingResourceApiError>(
  "StackMissingResourceError",
)(
  {
    code: Schema.Literal("missing_marketplace_resource"),
    message: Schema.String,
    resources: Schema.Array(Stack.ResourceRef),
  },
  { httpApiStatus: 424 },
) {}

export class StackMarketplaceUnavailableApiError extends Schema.ErrorClass<StackMarketplaceUnavailableApiError>(
  "StackMarketplaceUnavailableError",
)(
  {
    code: Schema.Literal("marketplace_unavailable"),
    message: Schema.String,
  },
  { httpApiStatus: 503 },
) {}

export class StackApplyApiError extends Schema.ErrorClass<StackApplyApiError>("StackApplyError")(
  {
    code: Schema.Literal("apply_failed"),
    message: Schema.String,
    rollback: Schema.Boolean,
    results: Schema.Array(Stack.Result),
  },
  { httpApiStatus: 500 },
) {}

const root = "/kilocode/stack"

export const StackPaths = {
  catalog: `${root}/catalog`,
  get: root,
  preview: `${root}/preview`,
  apply: `${root}/apply`,
  detect: `${root}/detect`,
} as const

export const StackApi = HttpApi.make("stack")
  .add(
    HttpApiGroup.make("stack")
      .add(
        HttpApiEndpoint.get("catalog", StackPaths.catalog, {
          query: WorkspaceRoutingQuery,
          success: described(StackCatalogResponse, "Stack catalog and Marketplace availability"),
          error: StackMarketplaceUnavailableApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "stack.catalog",
            summary: "Get Stack catalog",
            description: "Get the built-in Stack taxonomy joined with current Marketplace resource availability.",
          }),
        ),
        HttpApiEndpoint.get("get", StackPaths.get, {
          query: WorkspaceRoutingQuery,
          success: described(StackStateResponse, "Current project Stack state"),
          error: [StackInvalidConfigApiError, StackMarketplaceUnavailableApiError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "stack.get",
            summary: "Get Stack state",
            description: "Get persisted Stack selections, managed resources, drift, and current revisions.",
          }),
        ),
        HttpApiEndpoint.get("detect", StackPaths.detect, {
          query: WorkspaceRoutingQuery,
          success: described(StackDetectionResponse, "Detected project technologies"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "stack.detect",
            summary: "Detect Stack technologies",
            description: "Scan the project filesystem and return detected catalog technologies with evidence.",
          }),
        ),
        HttpApiEndpoint.post("preview", StackPaths.preview, {
          query: WorkspaceRoutingQuery,
          payload: StackPreviewInput,
          success: described(StackPreviewResponse, "Deterministic Stack review plan"),
          error: [StackInvalidConfigApiError, StackInvalidDraftApiError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "stack.preview",
            summary: "Preview Stack changes",
            description: "Validate Stack selections and return a deterministic plan without writing project state.",
          }),
        ),
        HttpApiEndpoint.post("apply", StackPaths.apply, {
          query: WorkspaceRoutingQuery,
          payload: StackApplyInput,
          success: described(StackApplyResponse, "Applied Stack results and refreshed state"),
          error: [
            StackInvalidConfigApiError,
            StackInvalidDraftApiError,
            StackStalePlanApiError,
            StackMissingResourceApiError,
            StackMarketplaceUnavailableApiError,
            StackApplyApiError,
          ],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "stack.apply",
            summary: "Apply Stack changes",
            description: "Apply a matching reviewed Stack plan transactionally and return refreshed project state.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "stack", description: "Project Stack selection routes." }))
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
