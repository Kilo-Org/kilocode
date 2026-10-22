import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const Scope = Schema.Literals(["global", "project"])
const Mode = Schema.Literals(["primary", "subagent", "all"])
const Prompt = Schema.String.check(Schema.isPattern(/\S/))
export const AgentBuilderID = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
)
const Body = {
  scope: Schema.optional(Scope),
  description: Schema.optional(Schema.String),
  mode: Schema.optional(Mode),
  model: Schema.optional(Schema.String),
  color: Schema.optional(Schema.String),
  steps: Schema.optional(Schema.Number),
  tools: Schema.optional(Schema.Array(Schema.String)),
  permission: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  prompt: Prompt,
}

export const AgentBuilderInput = Schema.Struct({ id: AgentBuilderID, ...Body })
export const AgentBuilderSaveInput = Schema.Struct({ id: Schema.optional(AgentBuilderID), ...Body })
export const AgentBuilderOutput = Schema.Struct({
  id: AgentBuilderID,
  scope: Scope,
  path: Schema.String,
  markdown: Schema.String,
})

export const AgentBuilderPaths = {
  preview: "/agent-builder/preview",
  save: "/agent-builder/:id",
} as const

export const AgentBuilderApi = HttpApi.make("agent-builder")
  .add(
    HttpApiGroup.make("agent-builder")
      .add(
        HttpApiEndpoint.post("preview", AgentBuilderPaths.preview, {
          query: WorkspaceRoutingQuery,
          payload: AgentBuilderInput,
          success: described(AgentBuilderOutput, "Agent markdown preview"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agentBuilder.preview",
            summary: "Preview agent markdown",
            description:
              "Validate an agent builder payload and return the canonical agent markdown without writing it.",
          }),
        ),
        HttpApiEndpoint.put("save", AgentBuilderPaths.save, {
          params: { id: AgentBuilderID },
          query: WorkspaceRoutingQuery,
          payload: AgentBuilderSaveInput,
          success: described(AgentBuilderOutput, "Saved agent markdown"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agentBuilder.save",
            summary: "Save agent markdown",
            description: "Save an agent builder payload as a canonical agent markdown file.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "agent-builder", description: "Kilo agent builder routes." }))
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
