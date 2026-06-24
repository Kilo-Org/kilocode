// kilocode_change - new file
// find_references tool: find all references to a symbol across the codebase

import { Effect, Schema } from "effect"
import path from "path"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"
import { Instance } from "@/kilocode/instance"

import DESCRIPTION from "./find-references.txt"

const Parameters = Schema.Struct({
  symbol: Schema.String.annotate({
    description: "The symbol name to find references for (function name, class name, variable name, etc.)",
  }),
  filePath: Schema.optional(Schema.String).annotate({
    description: "Optional file path to narrow the search scope.",
  }),
  kind: Schema.optional(Schema.String).annotate({
    description: "Filter by symbol kind: 'function', 'class', 'method', 'variable', 'interface', 'all' (default).",
  }),
})

type RefResult = {
  filePath: string
  line: number
  kind: string
  context: string
}

type Meta = {
  symbol: string
  definitions: Array<{ filePath: string; line: number; kind: string; name: string }>
  references: RefResult[]
}

export const FindReferencesTool = Tool.define(
  "find_references",
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
          permission: "find_references",
          patterns: [params.symbol],
          always: ["*"],
          metadata: { symbol: params.symbol },
        })

        const result = yield* Effect.promise(() => KiloIndexing.graphFindReferences(params.symbol, params.filePath))
        const definitions: Meta["definitions"] = result.definitions.map((n) => ({
          filePath: normalizePath(n.filePath),
          line: n.startLine,
          kind: n.kind,
          name: n.name,
        }))

        const allRefs: RefResult[] = result.references.map((ref) => ({
          filePath: normalizePath(ref.filePath),
          line: ref.startLine,
          kind: ref.kind,
          context: `${ref.kind} ${ref.name}`,
        }))

        // Deduplicate
        const seen = new Set<string>()
        const uniqueRefs = allRefs.filter((r) => {
          const key = `${r.filePath}:${r.line}:${r.kind}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })

        uniqueRefs.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line)

        if (uniqueRefs.length === 0) {
          return {
            title: "Find References",
            metadata: { symbol: params.symbol, definitions, references: [] },
            output: `Found ${definitions.length} definition(s) for "${params.symbol}" but no references.`,
          }
        }

        const output = [
          `Found ${definitions.length} definition(s) and ${uniqueRefs.length} reference(s) for "${params.symbol}":`,
          "",
          "Definitions:",
          ...definitions.map((d) => `  ${d.filePath}:${d.line} (${d.kind}) ${d.name}`),
          "",
          "References:",
          ...uniqueRefs.map((r) => `  ${r.filePath}:${r.line} [${r.kind}] in ${r.context}`),
        ]

        return {
          title: "Find References",
          metadata: { symbol: params.symbol, definitions, references: uniqueRefs },
          output: output.join("\n").trim(),
        }
      }).pipe(Effect.orDie),
  }),
)

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}
