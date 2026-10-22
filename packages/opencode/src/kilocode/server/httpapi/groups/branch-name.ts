import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionID } from "@/session/schema"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const BranchNamePaths = {
  generate: "/session/:sessionID/branch-name",
} as const

export const BranchNamePayload = Schema.Struct({
  prompt: Schema.String,
  providerID: Schema.optional(ProviderV2.ID),
  modelID: Schema.optional(ModelV2.ID),
})

const BranchNameResponse = Schema.Struct({
  branch: Schema.NullOr(Schema.String),
})

export const BranchNameApi = HttpApi.make("branch-name")
  .add(
    HttpApiGroup.make("branch-name")
      .add(
        HttpApiEndpoint.post("generate", BranchNamePaths.generate, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: BranchNamePayload,
          success: described(BranchNameResponse, "Generated branch name or null when the task is not clear yet"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "branchName.generate",
            summary: "Generate branch name",
            description: "Generate a task-focused branch name from the current conversation.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "branch-name",
          description: "Kilo branch name routes.",
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
