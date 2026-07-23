import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceRef } from "@/effect/instance-ref"
import { aggregateSessionStats } from "@/cli/cmd/stats"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"

const emptyStats = {
  totalSessions: 0,
  totalMessages: 0,
  totalCost: 0,
  totalTokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
  toolUsage: {},
  modelUsage: {},
  dateRange: { earliest: Date.now(), latest: Date.now() },
  days: 0,
  costPerDay: 0,
  tokensPerSession: 0,
  medianTokensPerSession: 0,
}

export const statsHandlers = HttpApiBuilder.group(InstanceHttpApi, "stats", (handlers) =>
  Effect.gen(function* () {
    const stats = Effect.fn("StatsHttpApi.stats")(function* () {
      const ref = yield* InstanceRef
      const project = ref?.project
      if (!project) return emptyStats
      // days undefined = all-time; projectFilter "" = current project
      return yield* aggregateSessionStats(undefined, "", project)
    })

    return handlers.handle("stats", stats)
  }),
)
