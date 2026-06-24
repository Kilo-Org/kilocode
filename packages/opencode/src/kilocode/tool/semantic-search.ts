import { Effect, Schema } from "effect"
import path from "path"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"
import { Instance } from "@/kilocode/instance"

import DESCRIPTION from "./semantic-search.txt"

// kilocode_change start - enhanced semantic search parameters
const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "The search query, expressed in natural language.",
  }),
  path: Schema.optional(Schema.String).annotate({
    description:
      "Limit search to specific subdirectory (relative to the current workspace directory). Leave empty for entire workspace.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of results to return (default 10, max 50).",
  }),
  type: Schema.optional(Schema.String).annotate({
    description: "Filter by code element type: 'function', 'class', 'method', 'interface', 'variable', or 'all' (default).",
  }),
})
// kilocode_change end

type SearchResult = {
  filePath: string
  score: number
  startLine: number
  endLine: number
  codeChunk: string
}

type Meta = {
  results: SearchResult[]
}

export const SemanticSearchTool = Tool.define(
  "semantic_search",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<Meta>> =>
      Effect.gen(function* () {
        if (!params.query) {
          throw new Error("query is required")
        }

        yield* ctx.ask({
          permission: "semantic_search",
          patterns: [params.query],
          always: ["*"],
          metadata: {
            query: params.query,
            path: params.path,
          },
        })

        const prefix = normalizeSearchPath(params.path)
        const matches = yield* Effect.promise(() => KiloIndexing.search(params.query, prefix))

        let results = matches.flatMap<SearchResult>((item) => {
          const payload = item.payload
          if (!payload) return []
          if (
            typeof payload.filePath !== "string" ||
            typeof payload.codeChunk !== "string" ||
            typeof payload.startLine !== "number" ||
            typeof payload.endLine !== "number"
          ) {
            return []
          }

          return [
            {
              filePath: normalizePath(payload.filePath),
              score: item.score,
              startLine: payload.startLine,
              endLine: payload.endLine,
              codeChunk: payload.codeChunk,
            },
          ]
        })

        // kilocode_change start - enhanced filtering
        const limit = Math.min(Math.max(1, params.limit ?? 10), 50)
        const typeFilter = params.type?.toLowerCase()
        if (typeFilter && typeFilter !== "all") {
          results = results.filter((r) => {
            const chunk = r.codeChunk.toLowerCase()
            if (typeFilter === "function") return chunk.includes("function ") || chunk.includes("def ") || chunk.includes("const ") || chunk.includes("=> ")
            if (typeFilter === "class") return chunk.includes("class ") || chunk.includes("interface ")
            if (typeFilter === "method") return chunk.includes("(") && (chunk.includes("async ") || chunk.includes("public ") || chunk.includes("private "))
            if (typeFilter === "interface") return chunk.includes("interface ") || chunk.includes("type ")
            if (typeFilter === "variable") return chunk.includes("const ") || chunk.includes("let ") || chunk.includes("var ")
            return true
          })
        }
        results = results.slice(0, limit)
        // kilocode_change end

        if (results.length === 0) {
          return {
            title: "Codebase Search",
            metadata: {
              results,
            },
            output: `No relevant code found for "${params.query}"${prefix ? ` in ${normalizePath(prefix)}` : ""}.`,
          }
        }

        const output = [
          `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${params.query}"${prefix ? ` in ${normalizePath(prefix)}` : ""}.`,
          "",
          ...results.flatMap((item, index) => {
            return [
              `${index + 1}. ${item.filePath}:${item.startLine}-${item.endLine} (score ${item.score.toFixed(4)})`,
              item.codeChunk,
              "",
            ]
          }),
        ]

        return {
          title: "Codebase Search",
          metadata: {
            results,
          },
          output: output.join("\n").trim(),
        }
      }).pipe(Effect.orDie),
  }),
)

function normalizeSearchPath(input?: string): string | undefined {
  if (!input) return undefined

  const absolute = path.resolve(Instance.directory, input)
  const relative = path.relative(Instance.directory, absolute)
  if (!relative || relative === ".") return undefined
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`path must be within the current workspace: ${input}`)
  }
  return path.normalize(relative)
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}
