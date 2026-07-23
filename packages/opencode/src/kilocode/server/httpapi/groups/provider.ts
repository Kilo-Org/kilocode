import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/provider"

const ReasoningOption = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("effort"),
    values: Schema.Array(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({
    type: Schema.Literal("toggle"),
  }),
  Schema.Struct({
    type: Schema.Literal("budget_tokens"),
    min: Schema.optional(Schema.Finite),
    max: Schema.optional(Schema.Finite),
  }),
])

export const VariantDiscoveryCandidate = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  modelName: Schema.String,
  reasoningOptions: Schema.Array(ReasoningOption),
  confidence: Schema.Literals(["high", "medium", "low"]),
  reason: Schema.String,
})

export const VariantDiscoveryResult = Schema.Struct({
  modelID: Schema.String,
  status: Schema.Literals(["matched", "review", "unmatched", "unsupported"]),
  selected: Schema.optional(VariantDiscoveryCandidate),
  candidates: Schema.Array(VariantDiscoveryCandidate),
  variants: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
  conflicts: Schema.optional(Schema.Array(Schema.String)),
})

export const VariantDiscoverySummary = Schema.Struct({
  total: Schema.Number,
  matched: Schema.Number,
  review: Schema.Number,
  unmatched: Schema.Number,
  unsupported: Schema.Number,
  totalVariants: Schema.Number,
  results: Schema.Array(VariantDiscoveryResult),
})

export const VariantDiscoveryBody = Schema.Struct({
  baseURL: Schema.String,
  npm: Schema.String,
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optional(Schema.String),
      ownedBy: Schema.optional(Schema.String),
      variants: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
    }),
  ),
})

export const VariantDiscoveryApi = HttpApi.make("variant-discovery")
  .add(
    HttpApiGroup.make("variant-discovery")
      .add(
        HttpApiEndpoint.post("discoverVariants", `${root}/discover-variants`, {
          query: WorkspaceRoutingQuery,
          payload: VariantDiscoveryBody,
          success: described(VariantDiscoverySummary, "Variant discovery summary"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.discoverVariants",
            summary: "Discover reasoning variants for custom-provider models",
            description:
              "Match custom-provider models against the models.dev catalog to find configurable reasoning effort values. " +
              "Returns a summary with per-model match status, candidate catalog entries, and discovered variant configurations.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "provider",
          description: "Provider variant discovery routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
