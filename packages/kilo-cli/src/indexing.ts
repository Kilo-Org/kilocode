import { toIndexingConfigInput, type IndexingConfig } from "@kilocode/indexing/config"
import { CodeIndexManager, type VectorStoreSearchResult } from "@kilocode/indexing/engine"
import { disabledIndexingStatus, normalizeIndexingStatus, type IndexingStatus } from "@kilocode/indexing/status"
import { define, type Context } from "@opencode-ai/plugin/effect/plugin"
import type { Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Tool } from "@opencode-ai/schema/tool"
import type { Info } from "@opencode-ai/schema/location"
import { Effect, Schema } from "effect"
import path from "node:path"
import type { ToolAuthorizationInput, ToolAuthorizer } from "./tool-authorization"
import { IndexingRpc } from "./indexing-rpc"

/**
 * V2 host for the Kilo codebase-indexing engine. It drives the real
 * `CodeIndexManager` from `@kilocode/indexing`, which was ported from Kilo main
 * at `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`.
 *
 * This is the host half of v1's `packages/opencode/src/kilocode/indexing.ts`,
 * reduced to what v2 can support today: lifecycle, status projection, and the
 * `semantic_search` tool. Unlike v1 it runs the engine in-process rather than in
 * a bundled Worker, and it does not resolve the Kilo embedding-model catalog.
 * Divergences are recorded in `kilocode/baseline/indexing-v2-parity.md`.
 */
export const INDEXING_PLUGIN_ID = "kilo.indexing"

export type IndexingLocation = Pick<Info, "directory" | "project">

export type IndexingPluginOptions = {
  /** Isolated application state root. The index root is derived below it. */
  readonly state?: string
  /** Explicit index root for tests or single-project hosts. */
  readonly root?: string | ((location: IndexingLocation) => string)
  /** Engine configuration, as accepted by `@kilocode/indexing/config`. */
  readonly settings?: IndexingConfig
  /** Primary-worktree overlay directory, when the host computes one. */
  readonly baselineDirectory?: string
  /** Host-owned execution approval for model-initiated semantic search. */
  readonly authorize?: ToolAuthorizer
}

export type IndexingSearchMatch = {
  readonly filePath: string
  readonly score: number
  readonly startLine: number
  readonly endLine: number
  readonly codeChunk: string
}

export type IndexingSearchOutput = {
  readonly title: string
  readonly output: string
  readonly results: readonly IndexingSearchMatch[]
}

export type IndexingHost = {
  /**
   * True once the engine finished `initialize` with the feature enabled and
   * configured. Mirrors v1's `initialized` flag, which gates tool registration
   * in `KiloIndexing.ready()`.
   */
  readonly available: boolean
  readonly status: () => IndexingStatus
  readonly search: (input: { readonly query: string; readonly path?: string }) => Promise<IndexingSearchOutput>
  readonly dispose: () => Promise<void>
}

/** Matches v1's index root: a single `indexing` folder under application state. */
export function indexingRoot(state: string) {
  return path.join(state, "indexing")
}

/** Mirrors v1 `pending` in `packages/opencode/src/kilocode/indexing.ts`. */
export function pendingIndexingStatus(): IndexingStatus {
  return {
    state: "In Progress",
    message: "Indexing is initializing.",
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
  }
}

/**
 * Start indexing for one Location. A disabled project and a failed
 * initialization both return an inert host, so callers only check `available`.
 */
export async function startIndexing(options: IndexingPluginOptions, location: IndexingLocation): Promise<IndexingHost> {
  if (options.settings?.enabled !== true) {
    return inert(disabledIndexingStatus("Codebase indexing is disabled for this project."))
  }

  const root = rootFor(options, location)
  // A configured store directory could otherwise point the engine at an existing
  // LanceDB store anywhere on disk and write to it. Refuse instead of silently
  // rewriting the value, and never echo the configured path.
  const store = options.settings.lancedb?.directory
  if (store !== undefined && !containedBy(root, store)) {
    return inert(errorIndexingStatus("indexing.lancedb.directory must stay inside the isolated index root"))
  }

  const manager = new CodeIndexManager(location.directory, root, options.baselineDirectory)
  // Progress arrives while `initialize` is still running, so the projection is
  // subscribed before the call and reconciled from the manager afterwards.
  const latest = { status: pendingIndexingStatus() }
  const progress = manager.onProgressUpdate.on(() => {
    latest.status = safeStatus(normalizeIndexingStatus(manager))
  })
  const failure = await manager.initialize(toIndexingConfigInput(options.settings)).then(
    () => undefined,
    (error: unknown) => error,
  )
  if (failure) {
    progress.dispose()
    await manager.dispose()
    return inert(failedIndexingStatus(failure))
  }

  latest.status = safeStatus(normalizeIndexingStatus(manager))
  return {
    available: latest.status.state !== "Disabled",
    status: () => latest.status,
    search: async (input) => {
      if (!input.query) throw new Error("query is required")
      const prefix = normalizeSearchPath(location.directory, input.path)
      return formatSearch(input.query, prefix, await manager.searchIndex(input.query, prefix))
    },
    dispose: async () => {
      progress.dispose()
      await manager.dispose()
    },
  }
}

const SearchInput = Schema.Struct({
  query: Schema.String.annotate({ description: "The search query, expressed in natural language." }),
  path: Schema.optional(Schema.String).annotate({
    description:
      "Limit search to specific subdirectory (relative to the current workspace directory). Leave empty for entire workspace.",
  }),
})

const DESCRIPTION = [
  "Find code snippets by semantic meaning and return ranked matches with file paths and line ranges.",
  "",
  "Use it early for open-ended exploration when the intent is known but the exact identifiers are not, then follow up with Grep and Read.",
  "Prefer Grep for an exact symbol or regex, Glob for filenames, and Read for a known file.",
  "Write the query in English. The search covers the current workspace only; limit it to one subdirectory with `path`.",
].join("\n")

/**
 * Location-scoped v2 plugin. The tool is registered only when the engine is
 * running, matching v1's registry gate on `KiloIndexing.ready()`.
 */
export function createIndexingPlugin(options: IndexingPluginOptions = {}): Plugin {
  return define({
    id: INDEXING_PLUGIN_ID,
    effect: (ctx) =>
      Effect.fn("KiloIndexingPlugin.effect")(function* (ctx: Context) {
        const host = yield* Effect.promise(() => startIndexing(options, ctx.location))
        yield* Effect.addFinalizer(() => Effect.promise(() => host.dispose()))
        yield* ctx.rpc.register(IndexingRpc, { status: () => Effect.sync(host.status) })
        if (!host.available) return

        yield* ctx.tool.transform((editor) => {
          editor.add({
            name: "semantic_search",
            description: DESCRIPTION,
            input: SearchInput,
            options: { codemode: false, permission: "semantic_search" },
            execute: (input, context) =>
              Effect.gen(function* () {
                yield* authorizeTool(options, context, {
                  action: "semantic_search",
                  resources: [input.query],
                  save: ["*"],
                  metadata: { query: input.query, ...(input.path ? { path: input.path } : {}) },
                })
                return yield* Effect.tryPromise({
                  try: async () => {
                    const result = await host.search(input)
                    return {
                      content: `${result.title}\n${result.output}`,
                      metadata: { results: result.results, sessionID: context.sessionID },
                    }
                  },
                  catch: (error: unknown) => new Tool.Error({ message: errorMessage(error) }),
                })
              }),
          })
        })
      })(ctx).pipe(Effect.orDie),
  })
}

/** Alias matching the naming used by the other built-in plugin modules. */
export const IndexingPlugin = createIndexingPlugin

function inert(status: IndexingStatus): IndexingHost {
  return {
    available: false,
    status: () => status,
    search: async () => {
      throw new Error(status.message)
    },
    dispose: async () => {},
  }
}

function errorIndexingStatus(message: string): IndexingStatus {
  return { state: "Error", message, processedFiles: 0, totalFiles: 0, percent: 0 }
}

/**
 * v1 put the raw failure message into the status. An engine failure can carry a
 * request URL, a provider response body, or a base URL with an embedded token,
 * so nothing from the failure text is surfaced here. Only values that are
 * provably static or numeric are: the error class, which is a source-level
 * identifier, and an HTTP status code.
 */
function failedIndexingStatus(error: unknown): IndexingStatus {
  const status = error && typeof error === "object" ? Reflect.get(error, "status") : undefined
  const detail = [
    error instanceof Error ? error.constructor.name : undefined,
    typeof status === "number" ? `HTTP ${status}` : undefined,
  ].filter((value): value is string => !!value)

  return errorIndexingStatus(
    `Failed to initialize: indexing could not start${detail.length ? ` (${detail.join(", ")})` : ""}. Set KILO_INDEXING_LOG=1 for local diagnostics on stderr.`,
  )
}

/**
 * The engine writes scan and watcher failures straight into its status message,
 * where they can carry the same request detail. Only its fixed prefixes are
 * recognised; anything else collapses to a stage-free notice.
 */
const stages = [
  { prefix: "Failed during initial scan", stage: "initial scan" },
  { prefix: "Failed to process file changes", stage: "file watch" },
  { prefix: "Failed to create embedder", stage: "embedder setup" },
  { prefix: "Failed to initialize vector store", stage: "vector store setup" },
] as const

function safeStatus(status: IndexingStatus): IndexingStatus {
  if (status.state !== "Error") return status
  const stage = stages.find((item) => status.message.startsWith(item.prefix))?.stage
  return errorIndexingStatus(
    `Indexing failed${stage ? ` during ${stage}` : ""}. Set KILO_INDEXING_LOG=1 for local diagnostics on stderr.`,
  )
}

/** Rejects a configured store directory that escapes the isolated index root. */
function containedBy(root: string, candidate: string) {
  if (!path.isAbsolute(candidate)) return false
  const relative = path.relative(root, path.normalize(candidate))
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function rootFor(options: IndexingPluginOptions, location: IndexingLocation) {
  if (typeof options.root === "function") return absolute(options.root(location))
  if (options.root) return absolute(options.root)
  if (options.state) return indexingRoot(absolute(options.state))
  throw new Error("Indexing requires an isolated state root or an explicit index root")
}

function absolute(value: string) {
  if (!path.isAbsolute(value)) throw new Error(`Indexing root must be absolute: ${value}`)
  return path.normalize(value)
}

/** Mirrors v1 `normalizeSearchPath`: workspace-relative scope, no escapes. */
function normalizeSearchPath(directory: string, input?: string) {
  if (!input) return undefined
  const relative = path.relative(directory, path.resolve(directory, input))
  if (!relative || relative === ".") return undefined
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`path must be within the current workspace: ${input}`)
  }
  return path.normalize(relative)
}

/** Mirrors the result projection in v1's `semantic_search` tool. */
function formatSearch(
  query: string,
  prefix: string | undefined,
  matches: readonly VectorStoreSearchResult[],
): IndexingSearchOutput {
  const results = matches.flatMap<IndexingSearchMatch>((item) => {
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
        filePath: posix(payload.filePath),
        score: item.score,
        startLine: payload.startLine,
        endLine: payload.endLine,
        codeChunk: payload.codeChunk,
      },
    ]
  })
  const scope = prefix ? ` in ${posix(prefix)}` : ""
  if (results.length === 0) {
    return { title: "Codebase Search", output: `No relevant code found for "${query}"${scope}.`, results }
  }

  return {
    title: "Codebase Search",
    output: [
      `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}"${scope}.`,
      "",
      ...results.flatMap((item, index) => [
        `${index + 1}. ${item.filePath}:${item.startLine}-${item.endLine} (score ${item.score.toFixed(4)})`,
        item.codeChunk,
        "",
      ]),
    ]
      .join("\n")
      .trim(),
    results,
  }
}

function posix(value: string) {
  return value.replaceAll("\\", "/")
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function authorizeTool(
  options: IndexingPluginOptions,
  context: Tool.Context,
  input: Pick<ToolAuthorizationInput, "action" | "resources" | "save" | "metadata">,
) {
  if (!options.authorize) return Effect.fail(new Tool.Error({ message: "Tool authorization is unavailable" }))
  return options.authorize({
    ...input,
    sessionID: context.sessionID,
    agent: context.agent,
    messageID: context.messageID,
    callID: context.id,
  })
}
