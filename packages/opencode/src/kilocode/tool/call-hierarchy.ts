// kilocode_change - new file
// call_hierarchy tool: show who calls a function and what it calls

import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"

import DESCRIPTION from "./call-hierarchy.txt"

const Parameters = Schema.Struct({
  symbol: Schema.String.annotate({
    description: "The function or method name to trace the call hierarchy for.",
  }),
  direction: Schema.optional(Schema.String).annotate({
    description: "Direction: 'incoming' (who calls it), 'outgoing' (what it calls), 'both' (default).",
  }),
  depth: Schema.optional(Schema.Number).annotate({
    description: "Maximum depth to traverse (default: 3, max: 5).",
  }),
})

type HierarchyItem = {
  name: string
  kind: string
  filePath: string
  line: number
  depth: number
}

type Meta = {
  symbol: string
  incoming: HierarchyItem[]
  outgoing: HierarchyItem[]
}

export const CallHierarchyTool = Tool.define(
  "call_hierarchy",
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
          permission: "call_hierarchy",
          patterns: [params.symbol],
          always: ["*"],
          metadata: { symbol: params.symbol },
        })

        const direction = params.direction ?? "both"
        const maxDepth = Math.min(Math.max(1, params.depth ?? 3), 5)

        const hierarchy = yield* Effect.promise(() =>
          KiloIndexing.graphCallHierarchy(params.symbol, direction, maxDepth),
        )

        const allIncoming: HierarchyItem[] = hierarchy.incoming.map((item) => ({
          name: item.node.name,
          kind: item.node.kind,
          filePath: normalizePath(item.node.filePath),
          line: item.node.startLine,
          depth: item.depth,
        }))

        const allOutgoing: HierarchyItem[] = hierarchy.outgoing.map((item) => ({
          name: item.node.name,
          kind: item.node.kind,
          filePath: normalizePath(item.node.filePath),
          line: item.node.startLine,
          depth: item.depth,
        }))

        // Deduplicate
        const dedup = (items: HierarchyItem[]) => {
          const seen = new Set<string>()
          return items.filter((i) => {
            const key = `${i.filePath}:${i.line}:${i.name}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
        }

        const incoming = dedup(allIncoming).sort((a, b) => a.depth - b.depth || a.filePath.localeCompare(b.filePath))
        const outgoing = dedup(allOutgoing).sort((a, b) => a.depth - b.depth || a.filePath.localeCompare(b.filePath))

        const lines: string[] = [
          `Call hierarchy for "${params.symbol}" (depth: ${maxDepth}):`,
          "",
        ]

        if (direction === "incoming" || direction === "both") {
          lines.push(`Incoming calls (${incoming.length}):`)
          if (incoming.length === 0) {
            lines.push("  No incoming calls found.")
          } else {
            for (const item of incoming) {
              const indent = "  ".repeat(item.depth)
              lines.push(`${indent}${item.name} (${item.kind}) at ${item.filePath}:${item.line}`)
            }
          }
          lines.push("")
        }

        if (direction === "outgoing" || direction === "both") {
          lines.push(`Outgoing calls (${outgoing.length}):`)
          if (outgoing.length === 0) {
            lines.push("  No outgoing calls found.")
          } else {
            for (const item of outgoing) {
              const indent = "  ".repeat(item.depth)
              lines.push(`${indent}${item.name} (${item.kind}) at ${item.filePath}:${item.line}`)
            }
          }
        }

        return {
          title: "Call Hierarchy",
          metadata: { symbol: params.symbol, incoming, outgoing },
          output: lines.join("\n").trim(),
        }
      }).pipe(Effect.orDie),
  }),
)

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}
