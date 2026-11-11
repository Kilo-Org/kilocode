import path from "path"
import type { VectorStoreSearchResult } from "@kilocode/kilo-indexing/engine"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status"
import type { AssertInput } from "@opencode/plugin/permission"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import DESCRIPTION from "./semantic-search.txt"
import { empty, normalizePath, scope } from "./semantic-search-output"

// The hint that glob and grep carry while semantic_search is available.
export const hint =
  "- When you are doing an open-ended search where you do not know the exact symbol name, use the `semantic_search` tool first to narrow down the search scope, then follow up with `Grep` and/or `Read`"

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

export interface Runtime {
  readonly directory: string
  readonly assert: (input: AssertInput) => Effect.Effect<void, unknown>
  readonly search: (query: string, prefix?: string) => Promise<VectorStoreSearchResult[]>
  readonly current: () => Promise<IndexingStatus>
}

export function semanticSearch(runtime: Runtime): Tool.Info<typeof Parameters, typeof Schema.String> {
  return {
    name: "semantic_search",
    description: DESCRIPTION,
    input: Parameters,
    output: Schema.String,
    // A direct tool, like glob and grep, so the model sees it beside them.
    options: { codemode: false },
    execute: (params, context) =>
      Effect.gen(function* () {
        if (!params.query) return yield* new Tool.Error({ message: "query is required" })

        yield* runtime
          .assert({
            sessionID: context.sessionID,
            agent: context.agent,
            action: "semantic_search",
            resources: [params.query],
            save: ["*"],
            metadata: {
              query: params.query,
              path: params.path,
            },
          })
          .pipe(Effect.mapError((error) => new Tool.Error({ message: error instanceof Error ? error.message : String(error) })))

        const prefix = yield* Effect.try({
          try: () => normalizeSearchPath(runtime.directory, params.path),
          catch: (error) => new Tool.Error({ message: error instanceof Error ? error.message : String(error) }),
        })
        const root = normalizePath(runtime.directory)
        const matches = yield* Effect.promise(() => runtime.search(params.query, prefix))

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
            runtime.current().then(
              (value) => value,
              () => undefined,
            ),
          )
          return {
            output: empty(params.query, root, prefix, status),
            metadata: { title: "Codebase Search", results, root, state: status?.state },
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
          output: output.join("\n").trim(),
          metadata: { title: "Codebase Search", results, root },
        }
      }),
  }
}

export function normalizeSearchPath(directory: string, input?: string): string | undefined {
  if (!input) return undefined

  const absolute = path.resolve(directory, input)
  const relative = path.relative(directory, absolute)
  if (!relative || relative === ".") return undefined
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`path must be within the current workspace: ${input}`)
  }
  return path.normalize(relative)
}
