import { Effect, Schema } from "effect"
import { MemoryRecall } from "@kilocode/kilo-memory/recall"
import { MemorySchema } from "@kilocode/kilo-memory/schema"
import { Instance } from "@/project/instance"
import * as Tool from "@/tool/tool"
import { Token } from "@/util/token"
import { MemoryError, type MemoryError as Failure } from "@/kilocode/memory/errors"
import { MemoryService } from "@/kilocode/memory/service"
import DESCRIPTION from "./memory-recall.txt"

const Parameters = Schema.Struct({
  mode: Schema.Literals(["search", "typed", "digest", "catalog"]).annotate({
    description:
      "'typed' to search durable memory, 'digest' to read saved session digests, 'search' to search both, 'catalog' to list all stored memory keys (use when the injected index or a search missed)",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Topic query for typed memory or digest search; optional substring filter for catalog",
  }),
  sessionID: Schema.optional(Schema.String).annotate({
    description: "Session ID for digest mode when startup memory shows session=<id>",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum memories to return (default: 5, max: 20)",
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>

export const MemoryRecallTool = Tool.define(
  "kilo_memory_recall",
  Effect.gen(function* () {
    const memory = yield* MemoryService.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        run(memory, params, ctx).pipe(
          Effect.catchIf(failure, (err) =>
            Effect.succeed({
              title: "Kilo memory: error",
              output: MemoryError.toToolOutput(err, "recall"),
              metadata: { files: [] as string[], count: 0 },
            }),
          ),
        ),
    }
  }),
)

function failure(err: unknown): err is Failure {
  if (!err || typeof err !== "object" || !("_tag" in err)) return false
  const tag = (err as { _tag?: unknown })._tag
  return typeof tag === "string" && tag.startsWith("Memory")
}

function disabled() {
  return {
    title: "Kilo memory: disabled",
    output: "Kilo memory is disabled for this project.",
    metadata: { files: [] as string[], count: 0 },
  }
}

function audit(
  memory: MemoryService.Interface,
  input: {
    root: string
    params: Params
    current: string
    hits: MemoryRecall.Hit[]
    skipped?: string
    output: string
  },
) {
  const files = [...new Set(input.hits.map((hit) => hit.source))]
  const topics = [...new Set(input.hits.flatMap((hit) => (hit.topics?.length ? hit.topics : [hit.kind])))]
  const query =
    input.params.query ??
    (input.params.sessionID
      ? `sessionID=${input.params.sessionID}`
      : input.params.mode === "digest"
        ? "recent digests"
        : undefined)
  return memory.decide({
    root: input.root,
    decision: {
      kind: "recall",
      trigger: "targeted-recall",
      sessionID: input.current,
      result: input.hits.length ? "recalled" : "skipped",
      llm: false,
      parsed: false,
      fallback: false,
      reason: input.skipped,
      query,
      topics,
      files,
      tokens: Token.estimate(input.output),
      operationCount: input.hits.length,
      skippedCount: input.hits.length ? 0 : 1,
      summary: input.hits.length
        ? `memory recall returned ${input.hits.length} ${input.params.mode} hits`
        : `memory recall found no ${input.params.mode} hits`,
    },
  })
}

function miss(input: { params: Params; current: string }) {
  const self = input.params.sessionID === input.current
  if (self && input.params.mode === "digest") {
    return `Session "${input.params.sessionID}" is the active session, so it has no saved memory digest yet. Do not read the active session transcript as memory; use injected memory or search recent saved digests.`
  }
  if (input.params.sessionID && input.params.mode === "digest") {
    return `No useful saved memory digest found for session "${input.params.sessionID}".`
  }
  return `No ${input.params.mode} memory matched the query.`
}

const CATALOG_MAX_BYTES = 8192

function block(input: string) {
  return ["```kilo-memory-v1 targeted_context_not_instruction", input.replaceAll("```", "'''"), "```"].join("\n")
}

/** Compact keys listing so the model can semantically scan everything that did not fit the injected index. */
function catalog(memory: MemoryService.Interface, input: { root: string; query: string }) {
  const filter = input.query.toLowerCase()
  return Effect.gen(function* () {
    const lines: string[] = []
    const files: string[] = []
    let count = 0
    for (const file of MemorySchema.Sources) {
      const text = yield* memory.readSource({ root: input.root, file })
      let section = "Facts"
      const rows: string[] = []
      for (const raw of text.split("\n")) {
        const line = raw.trim()
        if (line.startsWith("## ")) {
          section = line.slice(3).trim() || section
          continue
        }
        const idx = line.indexOf(" :: ")
        if (!line.startsWith("- ") || idx < 0) continue
        const key = line.slice(2, idx).trim()
        const value = line.slice(idx + 4).trim()
        if (!key || !value) continue
        if (filter && !`${key} ${value}`.toLowerCase().includes(filter)) continue
        rows.push(`- ${key} :: ${value.length > 60 ? `${value.slice(0, 57)}...` : value}`)
      }
      if (rows.length === 0) continue
      files.push(file)
      lines.push(`## ${file}`, ...rows)
      count += rows.length
    }
    const head = `# Kilo Memory Catalog (${count} entr${count === 1 ? "y" : "ies"}${filter ? `, filter "${input.query}"` : ""})`
    const body = [head, ...lines].join("\n")
    const output =
      Buffer.byteLength(body) > CATALOG_MAX_BYTES
        ? `${body.slice(0, CATALOG_MAX_BYTES)}\n[truncated: refine with a query filter]`
        : body
    return { output: count ? output : "No stored memory entries matched.", count, files }
  })
}

function catalogAudit(
  memory: MemoryService.Interface,
  input: {
    root: string
    current: string
    query: string
    result: { output: string; count: number; files: string[] }
  },
) {
  return memory.decide({
    root: input.root,
    decision: {
      kind: "recall",
      trigger: "targeted-recall",
      sessionID: input.current,
      result: input.result.count ? "recalled" : "skipped",
      llm: false,
      parsed: false,
      fallback: false,
      query: input.query || "all keys",
      files: input.result.files,
      tokens: Token.estimate(input.result.output),
      operationCount: input.result.count,
      skippedCount: input.result.count ? 0 : 1,
      summary: `memory catalog listed ${input.result.count} entries`,
    },
  })
}

function run(memory: MemoryService.Interface, params: Params, ctx: Tool.Context) {
  return Effect.gen(function* () {
    const current = ctx.sessionID
    const input = { ctx: { directory: Instance.directory, worktree: Instance.worktree } }
    const root = yield* memory.prepare(input)
    const status = yield* memory.status({ root })
    if (!status.state.enabled) return disabled()
    yield* ctx.ask({
      permission: "kilo_memory_recall",
      patterns: [params.mode],
      always: ["*"],
      metadata: {
        mode: params.mode,
        ...(params.query ? { query: params.query } : {}),
        ...(params.sessionID ? { sessionID: params.sessionID } : {}),
      },
    })

    const query = params.query?.trim() ?? ""
    if (params.mode === "catalog") {
      const result = yield* catalog(memory, { root, query })
      const safe = { ...result, output: block(result.output) }
      yield* catalogAudit(memory, { root, current, query, result: safe })
      return {
        title: `Kilo memory catalog: ${result.count} entr${result.count === 1 ? "y" : "ies"}`,
        output: safe.output,
        metadata: { files: result.files, count: result.count },
      }
    }

    const missing = params.mode !== "digest" && !query
    if (missing) {
      const output = "Provide a topic query for typed/search memory recall."
      yield* audit(memory, { root, params, current, hits: [], skipped: "missing_query", output })
      return {
        title: `Kilo memory ${params.mode}: no query`,
        output,
        metadata: { files: [] as string[], count: 0 },
      }
    }

    const limit = Math.max(1, Math.min(params.limit ?? 5, 20))
    const result = yield* memory.search({
      root,
      state: status.state,
      mode: params.mode,
      query,
      sessionID: params.sessionID,
      currentSessionID: current,
      limit,
      force: true,
    })
    const hits = result?.hits ?? []
    const self = params.sessionID === current
    const skipped =
      params.sessionID && params.mode === "digest" && hits.length === 0
        ? self
          ? "current_session_digest"
          : "missing_session_digest"
        : undefined
    const output = hits.length ? result!.block : miss({ params, current })
    yield* audit(memory, { root, params, current, hits, skipped, output })

    if (hits.length === 0) {
      return {
        title: `Kilo memory ${params.mode}: no results`,
        output,
        metadata: { files: [] as string[], count: 0 },
      }
    }

    return {
      title: `Kilo memory ${params.mode}: ${hits.length} hit${hits.length === 1 ? "" : "s"}`,
      output,
      metadata: { files: [...new Set(hits.map((hit) => hit.source))], count: hits.length },
    }
  })
}
