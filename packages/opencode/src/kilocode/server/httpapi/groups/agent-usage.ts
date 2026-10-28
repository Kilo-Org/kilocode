import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQueryFields,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { InvalidRequestError } from "@/server/routes/instance/httpapi/errors"
import { AgentUsage } from "@/kilocode/agent-usage"

const root = "/kilocode/agent-usage"

export const AgentUsagePaths = {
  summary: `${root}/summary`,
  runs: `${root}/runs`,
} as const

const Window = {
  agent: Schema.optional(Schema.String),
  from: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  to: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
}

export const AgentUsageSummaryQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  ...Window,
})

export const AgentUsageRunsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  ...Window,
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 }))),
  cursor: Schema.optional(Schema.String),
})

export const AgentUsageRunPage = Schema.Struct({
  items: Schema.Array(AgentUsage.Run),
  /** Opaque cursor for the next (older) page; absent on the last page. */
  next: Schema.optional(Schema.String),
})

export const AgentUsageApi = HttpApi.make("agent-usage")
  .add(
    HttpApiGroup.make("agent-usage")
      .add(
        HttpApiEndpoint.get("summary", AgentUsagePaths.summary, {
          query: AgentUsageSummaryQuery,
          success: described(Schema.Array(AgentUsage.Summary), "Per-agent usage rollup for the project"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agentUsage.summary",
            summary: "Get agent usage summary",
            description:
              "Get a per-agent rollup of runs, sessions, direct cost, active time, tokens, errors, and the last run time for the routed project.",
          }),
        ),
        HttpApiEndpoint.get("runs", AgentUsagePaths.runs, {
          query: AgentUsageRunsQuery,
          success: described(AgentUsageRunPage, "One page of agent runs, newest first"),
          error: InvalidRequestError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agentUsage.runs",
            summary: "List agent runs",
            description:
              "List agent runs newest first by start time, with optional agent and time window filters. Pages by the opaque `next` cursor returned by the previous page.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "agent-usage",
          description: "Kilo agent usage routes.",
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
