// kilocode_change - new file
// symbol_context tool: 360-degree view of a symbol

import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"

import DESCRIPTION from "./symbol-context.txt"

const Parameters = Schema.Struct({
  symbol: Schema.String.annotate({
    description: "The symbol name to get full context for (function, class, method, variable, etc.).",
  }),
})

type Meta = {
  symbol: string
  definitions: Array<{ name: string; kind: string; filePath: string; line: number }>
  callers: Array<{ name: string; kind: string; filePath: string; line: number }>
  callees: Array<{ name: string; kind: string; filePath: string; line: number }>
  subclasses: Array<{ name: string; kind: string; filePath: string; line: number }>
  superclasses: Array<{ name: string; kind: string; filePath: string; line: number }>
  imports: Array<{ sourcePath: string; importedNames: string[] }>
  importedBy: string[]
}

export const SymbolContextTool = Tool.define(
  "symbol_context",
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
          permission: "symbol_context",
          patterns: [params.symbol],
          always: ["*"],
          metadata: { symbol: params.symbol },
        })

        const data = yield* Effect.promise(() => KiloIndexing.graphContext(params.symbol))

        const definitions = data.definitions.map((n: any) => ({ name: n.name, kind: n.kind, filePath: normalizePath(n.filePath), line: n.startLine }))
        const callers = data.callers.map((n: any) => ({ name: n.name, kind: n.kind, filePath: normalizePath(n.filePath), line: n.startLine }))
        const callees = data.callees.map((n: any) => ({ name: n.name, kind: n.kind, filePath: normalizePath(n.filePath), line: n.startLine }))
        const subclasses = data.subclasses.map((n: any) => ({ name: n.name, kind: n.kind, filePath: normalizePath(n.filePath), line: n.startLine }))
        const superclasses = data.superclasses.map((n: any) => ({ name: n.name, kind: n.kind, filePath: normalizePath(n.filePath), line: n.startLine }))

        if (definitions.length === 0) {
          return {
            title: "Symbol Context",
            metadata: { symbol: params.symbol, definitions: [], callers: [], callees: [], subclasses: [], superclasses: [], imports: data.imports, importedBy: data.importedBy },
            output: `No symbol found matching "${params.symbol}".`,
          }
        }

        const lines: string[] = [
          `360° context for "${params.symbol}":`,
          "",
          `Definitions (${definitions.length}):`,
          ...definitions.map((d) => `  ${d.name} (${d.kind}) at ${d.filePath}:${d.line}`),
          "",
          `Callers (${callers.length}):`,
          ...(callers.length > 0 ? callers.slice(0, 15).map((c) => `  ${c.name} (${c.kind}) at ${c.filePath}:${c.line}`) : ["  None"]),
          ...(callers.length > 15 ? [`  ... and ${callers.length - 15} more`] : []),
          "",
          `Callees (${callees.length}):`,
          ...(callees.length > 0 ? callees.slice(0, 15).map((c) => `  ${c.name} (${c.kind}) at ${c.filePath}:${c.line}`) : ["  None"]),
          ...(callees.length > 15 ? [`  ... and ${callees.length - 15} more`] : []),
          "",
        ]

        if (subclasses.length > 0 || superclasses.length > 0) {
          lines.push(`Inheritance:`)
          if (superclasses.length > 0) {
            lines.push(`  Extends: ${superclasses.map((s) => s.name).join(", ")}`)
          }
          if (subclasses.length > 0) {
            lines.push(`  Extended by: ${subclasses.map((s) => s.name).join(", ")}`)
          }
          lines.push("")
        }

        if (data.imports.length > 0) {
          lines.push(`Imports (${data.imports.length}):`)
          for (const imp of data.imports.slice(0, 10)) {
            lines.push(`  from ${normalizePath(imp.sourcePath)}: ${imp.importedNames.join(", ")}`)
          }
          lines.push("")
        }

        if (data.importedBy.length > 0) {
          lines.push(`Imported by (${data.importedBy.length}):`)
          for (const ib of data.importedBy.slice(0, 10)) {
            lines.push(`  ${normalizePath(ib)}`)
          }
        }

        return {
          title: "Symbol Context",
          metadata: { symbol: params.symbol, definitions, callers, callees, subclasses, superclasses, imports: data.imports, importedBy: data.importedBy },
          output: lines.join("\n").trim(),
        }
      }).pipe(Effect.orDie),
  }),
)

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}
