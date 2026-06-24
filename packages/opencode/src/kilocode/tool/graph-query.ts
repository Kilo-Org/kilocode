// kilocode_change - new file
// graph_query tool: raw SQL queries against the codebase graph database

import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"

import DESCRIPTION from "./graph-query.txt"

const Parameters = Schema.Struct({
  sql: Schema.String.annotate({
    description: "SQL query to run against the graph database. Tables: graph_nodes, graph_edges, symbol_table, import_map.",
  }),
})

type Meta = {
  sql: string
  rowCount: number
  results: unknown[]
}

export const GraphQueryTool = Tool.define(
  "graph_query",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<Meta>> =>
      Effect.gen(function* () {
        if (!params.sql) {
          throw new Error("sql query is required")
        }

        yield* ctx.ask({
          permission: "graph_query",
          patterns: ["*"],
          always: ["*"],
          metadata: { sql: params.sql },
        })

        const results = yield* Effect.promise(() => KiloIndexing.graphQuery(params.sql))

        const lines: string[] = [
          `Graph query results (${results.length} row(s)):`,
          "",
        ]

        for (let i = 0; i < Math.min(results.length, 50); i++) {
          lines.push(JSON.stringify(results[i], null, 2))
        }

        if (results.length > 50) {
          lines.push(`\n... and ${results.length - 50} more rows`)
        }

        return {
          title: "Graph Query",
          metadata: { sql: params.sql, rowCount: results.length, results: results.slice(0, 50) },
          output: lines.join("\n").trim(),
        }
      }).pipe(Effect.orDie),
  }),
)
