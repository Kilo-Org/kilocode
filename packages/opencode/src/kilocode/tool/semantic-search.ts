import { Effect, Schema } from "effect"
import path from "path"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"
import { Instance } from "@/kilocode/instance"
import { empty, normalizePath, scope } from "./semantic-search-output"

import DESCRIPTION from "./semantic-search.txt"

const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "The search query, expressed in natural language.",
  }),
  path: Schema.optional(Schema.String).annotate({
    description:
      "Limit search to a subdirectory, relative to the indexed root. Leave empty to search the whole indexed root.",
  }),
})

type SearchResult = {
  filePath: string
  score: number
  startLine: number
  endLine: number
  codeChunk: string
}

type Meta = {
  results: SearchResult[]
  /** Absolute root the index covers, so a caller can tell what was actually searched. */
  root: string
  /** Index state at query time; only resolved when nothing matched. */
  state?: KiloIndexing.Status["state"]
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
        const root = normalizePath(Instance.directory)
        const matches = yield* Effect.promise(() => KiloIndexing.search(params.query, prefix))

        const results = matches.flatMap<SearchResult>((item) => {
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

        if (results.length === 0) {
          // An empty result set is ambiguous: the index may be disabled, still
          // building, or broken. Report which, so the caller does not read this
          // as proof that no matching code exists.
          const status = yield* Effect.promise(() =>
            KiloIndexing.current().then(
              (value) => value,
              () => undefined,
            ),
          )
          return {
            title: "Codebase Search",
            metadata: {
              results,
              root,
              state: status?.state,
            },
            output: empty(params.query, root, prefix, status),
          }
        }

        const output = [
          `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${params.query}" in ${scope(root, prefix)}.`,
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
            root,
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
