import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/commit-message"

export const CommitMessagePayload = Schema.Struct({
  path: Schema.String.annotate({ description: "Workspace/repo path" }),
  selectedFiles: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Optional subset of files to include",
  }),
  previousMessage: Schema.optional(Schema.String).annotate({
    description: "Previously generated message — triggers regeneration with a different result",
  }),
})

const CommitMessageResponse = Schema.Struct({
  message: Schema.String,
})

export class CommitMessageNoChangesError extends Schema.ErrorClass<CommitMessageNoChangesError>(
  "CommitMessageNoChangesError",
)(
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

export const CommitMessageApi = HttpApi.make("commit-message")
  .add(
    HttpApiGroup.make("commit-message")
      .add(
        HttpApiEndpoint.post("generate", root, {
          query: WorkspaceRoutingQuery,
          payload: CommitMessagePayload,
          success: described(CommitMessageResponse, "Generated commit message"),
          error: [HttpApiError.BadRequest, CommitMessageNoChangesError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "commitMessage.generate",
            summary: "Generate commit message",
            description: "Generate a commit message using AI based on the current git diff.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "commit-message",
          description: "Kilo commit message routes.",
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
