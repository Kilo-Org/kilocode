import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ResponseLensPayload } from "@/kilocode/response-lens"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

export class ResponseLensFailedError extends Schema.ErrorClass<ResponseLensFailedError>("ResponseLensFailedError")(
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

const Response = Schema.Struct({
  text: Schema.String,
  truncated: Schema.Boolean,
  model: ResponseLensPayload.fields.model,
  usage: Schema.Struct({
    inputTokens: Schema.optional(Schema.Number),
    outputTokens: Schema.optional(Schema.Number),
    totalTokens: Schema.optional(Schema.Number),
  }),
})

export const ResponseLensApi = HttpApi.make("response-lens").add(
  HttpApiGroup.make("response-lens")
    .add(
      HttpApiEndpoint.post("explain", "/response-lens/explain", {
        query: WorkspaceRoutingQuery,
        payload: ResponseLensPayload,
        success: described(Response, "Brief contextual explanation without creating a chat session"),
        error: [HttpApiError.BadRequest, ResponseLensFailedError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "responseLens.explain",
          summary: "Explain selected text briefly",
          description:
            "Explain a bounded selection and nearby conversation using the explicitly selected model, without tools or session persistence.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
