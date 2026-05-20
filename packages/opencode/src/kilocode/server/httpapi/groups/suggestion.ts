import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Suggestion } from "@/kilocode/suggestion"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/suggestion"

const SuggestionRequestID = Schema.String

export const SuggestionAcceptPayload = Schema.Struct({
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: "Zero-based action index to accept",
  }),
})

export const SuggestionPaths = {
  list: root,
  accept: `${root}/:requestID/accept`,
  dismiss: `${root}/:requestID/dismiss`,
} as const

export const SuggestionApi = HttpApi.make("suggestion")
  .add(
    HttpApiGroup.make("suggestion")
      .add(
        HttpApiEndpoint.get("list", SuggestionPaths.list, {
          success: described(Schema.Array(Suggestion.RequestSchema), "List of pending suggestions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "suggestion.list",
            summary: "List pending suggestions",
            description: "Get all pending suggestion requests across all sessions.",
          }),
        ),
        HttpApiEndpoint.post("accept", SuggestionPaths.accept, {
          params: { requestID: SuggestionRequestID },
          payload: SuggestionAcceptPayload,
          success: described(Schema.Boolean, "Suggestion accepted successfully"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "suggestion.accept",
            summary: "Accept suggestion request",
            description: "Accept a suggestion request from the AI assistant.",
          }),
        ),
        HttpApiEndpoint.post("dismiss", SuggestionPaths.dismiss, {
          params: { requestID: SuggestionRequestID },
          success: described(Schema.Boolean, "Suggestion dismissed successfully"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "suggestion.dismiss",
            summary: "Dismiss suggestion request",
            description: "Dismiss a suggestion request from the AI assistant.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "suggestion",
          description: "Kilo suggestion routes.",
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
