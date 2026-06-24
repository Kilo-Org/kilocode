// kilocode_change - new file
// impact_analysis tool: blast radius analysis for code changes

import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"

import DESCRIPTION from "./impact-analysis.txt"

const Parameters = Schema.Struct({
  symbol: Schema.String.annotate({
    description: "The symbol (function, class, variable) to analyze impact for.",
  }),
  maxDepth: Schema.optional(Schema.Number).annotate({
    description: "Maximum depth to traverse (default: 3, max: 5).",
  }),
})

type ImpactItem = {
  name: string
  kind: string
  filePath: string
  line: number
  depth: number
  relation: string
  confidence: number
}

type Meta = {
  symbol: string
  affected: ImpactItem[]
  totalCount: number
  maxDepth: number
}

export const ImpactAnalysisTool = Tool.define(
  "impact_analysis",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<Meta>> =>
      Effect.gen(function* () {
        if (!params.symbol) {
          throw new Error("symbol is required")
        }

        yield* ctx.ask({
          permission: "impact_analysis",
          patterns: [params.symbol],
          always: ["*"],
          metadata: { symbol: params.symbol },
        })

        const maxDepth = Math.min(Math.max(1, params.maxDepth ?? 3), 5)
        const results = yield* Effect.promise(() => KiloIndexing.graphImpact(params.symbol, maxDepth))

        if (results.length === 0) {
          return {
            title: "Impact Analysis",
            metadata: { symbol: params.symbol, affected: [], totalCount: 0, maxDepth },
            output: `No impact found for "${params.symbol}". The symbol may not be indexed yet.`,
          }
        }

        const affected: ImpactItem[] = results.map((r: any) => ({
          name: r.node.name,
          kind: r.node.kind,
          filePath: normalizePath(r.node.filePath),
          line: r.node.startLine,
          depth: r.depth,
          relation: r.relation,
          confidence: r.confidence,
        }))

        const byDepth = new Map<number, ImpactItem[]>()
        for (const item of affected) {
          const list = byDepth.get(item.depth) ?? []
          list.push(item)
          byDepth.set(item.depth, list)
        }

        const lines: string[] = [
          `Impact analysis for "${params.symbol}" (max depth: ${maxDepth}):`,
          `Total affected symbols: ${affected.length}`,
          "",
        ]

        for (let d = 1; d <= maxDepth; d++) {
          const items = byDepth.get(d) ?? []
          if (items.length === 0) continue
          const label = d === 1 ? "WILL BREAK" : d === 2 ? "LIKELY AFFECTED" : "POTENTIALLY AFFECTED"
          lines.push(`Depth ${d} (${label}): ${items.length} symbol(s)`)
          for (const item of items.slice(0, 20)) {
            lines.push(`  ${item.name} (${item.kind}) [${item.relation}] confidence: ${(item.confidence * 100).toFixed(0)}% at ${item.filePath}:${item.line}`)
          }
          if (items.length > 20) {
            lines.push(`  ... and ${items.length - 20} more`)
          }
          lines.push("")
        }

        return {
          title: "Impact Analysis",
          metadata: { symbol: params.symbol, affected, totalCount: affected.length, maxDepth },
          output: lines.join("\n").trim(),
        }
      }).pipe(Effect.orDie),
  }),
)

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}
