// kilocode_change - new file
// dependency_graph tool: analyze file dependencies and find circular imports

import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"

import DESCRIPTION from "./dependency-graph.txt"

const Parameters = Schema.Struct({
  filePath: Schema.optional(Schema.String).annotate({
    description: "File path to analyze dependencies for. If omitted, shows all circular dependencies in the project.",
  }),
  maxDepth: Schema.optional(Schema.Number).annotate({
    description: "Maximum depth for dependency chain (default: 5, max: 10).",
  }),
})

type DepItem = {
  filePath: string
  imports: string[]
  importedBy: string[]
  depth: number
}

type Meta = {
  filePath?: string
  circular: string[][]
  chain: DepItem[]
}

export const DependencyGraphTool = Tool.define(
  "dependency_graph",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<Meta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "dependency_graph",
          patterns: params.filePath ? [params.filePath] : ["*"],
          always: ["*"],
          metadata: { filePath: params.filePath },
        })

        const maxDepth = Math.min(Math.max(1, params.maxDepth ?? 5), 10)

        const result = yield* Effect.promise(() =>
          KiloIndexing.graphDependencies(params.filePath, maxDepth),
        )

        const circular = result.circular
        const chain: DepItem[] = result.chain

        const lines: string[] = []

        if (params.filePath) {
          lines.push(`Dependency analysis for ${normalizePath(params.filePath)}:`)
          lines.push("")

          if (chain.length === 0) {
            lines.push("No dependencies found.")
          } else {
            for (const item of chain) {
              const indent = "  ".repeat(item.depth)
              lines.push(`${indent}${normalizePath(item.filePath)}`)
              if (item.imports.length > 0) {
                lines.push(`${indent}  imports: ${item.imports.map(normalizePath).join(", ")}`)
              }
              if (item.importedBy.length > 0) {
                lines.push(`${indent}  imported by: ${item.importedBy.map(normalizePath).join(", ")}`)
              }
            }
          }
          lines.push("")
        }

        lines.push(`Circular dependencies found: ${circular.length}`)
        if (circular.length === 0) {
          lines.push("  No circular dependencies detected.")
        } else {
          for (let i = 0; i < circular.length; i++) {
            lines.push(`  Cycle ${i + 1}:`)
            for (const file of circular[i]) {
              lines.push(`    ${normalizePath(file)}`)
            }
          }
        }

        return {
          title: "Dependency Graph",
          metadata: { filePath: params.filePath, circular, chain },
          output: lines.join("\n").trim(),
        }
      }).pipe(Effect.orDie),
  }),
)

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}
