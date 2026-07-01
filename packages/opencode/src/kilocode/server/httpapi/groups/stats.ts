import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/stats"

const TokenBreakdown = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.Number,
  cache: Schema.Struct({
    read: Schema.Number,
    write: Schema.Number,
  }),
})

const ModelUsage = Schema.Struct({
  messages: Schema.Number,
  tokens: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    cache: Schema.Struct({
      read: Schema.Number,
      write: Schema.Number,
    }),
  }),
  cost: Schema.Number,
})

export const SessionStats = Schema.Struct({
  totalSessions: Schema.Number,
  totalMessages: Schema.Number,
  totalCost: Schema.Number,
  totalTokens: TokenBreakdown,
  toolUsage: Schema.Record(Schema.String, Schema.Number),
  modelUsage: Schema.Record(Schema.String, ModelUsage),
  dateRange: Schema.Struct({
    earliest: Schema.Number,
    latest: Schema.Number,
  }),
  days: Schema.Number,
  costPerDay: Schema.Number,
  tokensPerSession: Schema.Number,
  medianTokensPerSession: Schema.Number,
})

export const StatsPaths = {
  stats: `${root}/stats`,
} as const

export const StatsApi = HttpApi.make("stats")
  .add(
    HttpApiGroup.make("stats")
      .add(
        HttpApiEndpoint.get("stats", StatsPaths.stats, {
          query: WorkspaceRoutingQuery,
          success: described(SessionStats, "Aggregated session usage statistics"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "stats.stats",
            summary: "Get session usage statistics",
            description:
              "Aggregate token usage, cost, model usage, and tool usage across sessions, scoped to the current project.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "stats",
          description: "Kilo session statistics routes.",
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
