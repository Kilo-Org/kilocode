import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AgentUsage } from "@/kilocode/agent-usage"
import { InvalidRequestError } from "@/server/routes/instance/httpapi/errors"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import type { AgentUsageRunsQuery, AgentUsageSummaryQuery } from "../groups/agent-usage"

const DEFAULT_LIMIT = 50

export const agentUsageHandlers = HttpApiBuilder.group(InstanceHttpApi, "agent-usage", (handlers) =>
  Effect.gen(function* () {
    const summary = Effect.fn("AgentUsageHttpApi.summary")(function* (ctx: {
      query: typeof AgentUsageSummaryQuery.Type
    }) {
      return yield* AgentUsage.summary({ agent: ctx.query.agent, from: ctx.query.from, to: ctx.query.to })
    })

    const runs = Effect.fn("AgentUsageHttpApi.runs")(function* (ctx: { query: typeof AgentUsageRunsQuery.Type }) {
      const limit = ctx.query.limit ?? DEFAULT_LIMIT
      const opaque = ctx.query.cursor
      const cursor =
        opaque === undefined
          ? undefined
          : yield* Effect.try({
              try: () => AgentUsage.cursor.decode(opaque),
              catch: () =>
                new InvalidRequestError({ message: "The cursor is not valid for agent runs.", field: "cursor" }),
            })
      const rows = yield* AgentUsage.runs({
        agent: ctx.query.agent,
        from: ctx.query.from,
        to: ctx.query.to,
        cursor,
        limit: limit + 1,
      })
      const items = rows.slice(0, limit)
      const last = items.at(-1)
      return { items, ...(rows.length > limit && last ? { next: AgentUsage.cursor.encode(last) } : {}) }
    })

    return handlers.handle("summary", summary).handle("runs", runs)
  }),
)
