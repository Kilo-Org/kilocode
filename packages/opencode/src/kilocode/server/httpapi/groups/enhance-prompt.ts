import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/enhance-prompt"

export const EnhancePromptPayload = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1)).annotate({ description: "The user's draft prompt to enhance" }),
})

const EnhancePromptResponse = Schema.Struct({
  text: Schema.String,
})

export const EnhancePromptApi = HttpApi.make("enhance-prompt")
  .add(
    HttpApiGroup.make("enhance-prompt")
      .add(
        HttpApiEndpoint.post("enhance", root, {
          query: WorkspaceRoutingQuery,
          payload: EnhancePromptPayload,
          success: described(EnhancePromptResponse, "Enhanced prompt text"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "enhancePrompt.enhance",
            summary: "Enhance prompt",
            description: "Rewrite a user's draft prompt into a clearer, more specific, and more effective prompt.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "enhance-prompt",
          description: "Kilo enhance prompt routes.",
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
