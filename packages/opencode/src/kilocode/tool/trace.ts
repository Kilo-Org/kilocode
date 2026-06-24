// kilocode_change - new file
// trace tool: find shortest path between two symbols in the codebase

import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"

import DESCRIPTION from "./trace.txt"

const Parameters = Schema.Struct({
  from: Schema.String.annotate({
    description: "The starting symbol name (function, class, etc.).",
  }),
  to: Schema.String.annotate({
    description: "The target symbol name to trace a path to.",
  }),
})

type Meta = {
  from: string
  to: string
  path: Array<{ name: string; kind: string; filePath: string; line: number }>
  pathLength: number
}

export const TraceTool = Tool.define(
  "trace",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<Meta>> =>
      Effect.gen(function* () {
        if (!params.from || !params.to) {
          throw new Error("both 'from' and 'to' symbols are required")
        }

        yield* ctx.ask({
          permission: "trace",
          patterns: [params.from, params.to],
          always: ["*"],
          metadata: { from: params.from, to: params.to },
        })

        const result = yield* Effect.promise(() => KiloIndexing.graphTrace(params.from, params.to))

        if (!result.path || result.path.length === 0) {
          return {
            title: "Trace",
            metadata: { from: params.from, to: params.to, path: [], pathLength: 0 },
            output: `No path found between "${params.from}" and "${params.to}".`,
          }
        }

        const path = result.path.map((n: any) => ({
          name: n.name,
          kind: n.kind,
          filePath: normalizePath(n.filePath),
          line: n.startLine,
        }))

        const lines: string[] = [
          `Shortest path from "${params.from}" to "${params.to}":`,
          `Path length: ${result.pathLength} node(s)`,
          "",
        ]

        for (let i = 0; i < path.length; i++) {
          const arrow = i < path.length - 1 ? " ->" : ""
          lines.push(`${i + 1}. ${path[i].name} (${path[i].kind}) at ${path[i].filePath}:${path[i].line}${arrow}`)
        }

        return {
          title: "Trace",
          metadata: { from: params.from, to: params.to, path, pathLength: result.pathLength },
          output: lines.join("\n").trim(),
        }
      }).pipe(Effect.orDie),
  }),
)

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}
