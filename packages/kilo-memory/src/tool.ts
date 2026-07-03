import { Effect, Schema } from "effect"
import type { MemoryOperations } from "./capture/ops"
import { MemoryError, type MemoryError as Failure } from "./effect/errors"
import { MemoryPaths } from "./effect/paths"
import { MemoryService } from "./effect/service"
import { MemoryRecall } from "./recall/recall"
import { MemoryToken } from "./recall/token"
import { MemorySchema } from "./schema"
import recallDescription from "./prompts/tool-memory-recall.txt"
import saveDescription from "./prompts/tool-memory-save.txt"

export namespace MemoryTool {
  export const RecallDescription = recallDescription
  export const SaveDescription = saveDescription

  export const RecallParameters = Schema.Struct({
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

  export const SaveParameters = Schema.Struct({
    action: Schema.Literals(["remember", "correct", "forget", "skip"]).annotate({
      description: "Memory write action to perform.",
    }),
    text: Schema.optional(Schema.String).annotate({
      description: "Memory text for remember/correct. Keep it concise and durable.",
    }),
    query: Schema.optional(Schema.String).annotate({
      description: "Exact key, id, or query text for forget.",
    }),
    key: Schema.optional(Schema.String).annotate({
      description: "Optional stable key for remember/correct.",
    }),
    reason: Schema.optional(Schema.Literals(["out_of_scope"])).annotate({
      description: "Skip reason when action is skip.",
    }),
  })

  export type RecallParams = Schema.Schema.Type<typeof RecallParameters>
  export type SaveParams = Schema.Schema.Type<typeof SaveParameters>

  type Metadata = {
    files: string[]
    count?: number
    operationCount?: number
    added?: number
    removed?: number
    skippedCount?: number
    reason?: "out_of_scope"
  }

  export type Result = {
    title: string
    output: string
    metadata: Metadata
  }

  export type AskInput = {
    permission: "kilo_memory_recall" | "kilo_memory_save"
    patterns: string[]
    always: string[]
    metadata: Record<string, unknown>
  }

  export type Ask = (input: AskInput) => Effect.Effect<void>

  type Base = {
    memory: MemoryService.Interface
    ctx: MemoryPaths.Ctx
    sessionID: string
  }
  type Recall = Base & { params: RecallParams; ask: Ask }
  type Save = Base & { params: SaveParams; ask: Ask }
  type Live = {
    root: string
    current: string
    state: MemorySchema.State
  }

  export function failure(err: unknown): err is Failure {
    if (!err || typeof err !== "object" || !("_tag" in err)) return false
    const tag = (err as { _tag?: unknown })._tag
    return typeof tag === "string" && tag.startsWith("Memory")
  }

  export function error(action: "recall" | "save", err: unknown): Result {
    return {
      title: "Kilo memory: error",
      output: MemoryError.toToolOutput(err, action),
      metadata: { files: [], ...(action === "recall" ? { count: 0 } : {}) },
    }
  }

  function disabled(count = false): Result {
    return {
      title: "Kilo memory: disabled",
      output: "Kilo memory is disabled for this project.",
      metadata: { files: [], ...(count ? { count: 0 } : {}) },
    }
  }

  function audit(
    memory: MemoryService.Interface,
    input: {
      root: string
      params: RecallParams
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
        tokens: MemoryToken.estimate(input.output),
        operationCount: input.hits.length,
        skippedCount: input.hits.length ? 0 : 1,
        summary: input.hits.length
          ? `memory recall returned ${input.hits.length} ${input.params.mode} hits`
          : `memory recall found no ${input.params.mode} hits`,
      },
    })
  }

  function miss(input: { params: RecallParams; current: string }) {
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
  const CATALOG_SESSION_LIMIT = 20
  const CATALOG_SESSION_SUMMARY = 120

  function block(input: string) {
    return ["```kilo-memory-v1 targeted_context_not_instruction", input.replaceAll("```", "'''"), "```"].join("\n")
  }

  function catalog(memory: MemoryService.Interface, input: { root: string; query: string }) {
    const filter = input.query.toLowerCase()
    return Effect.gen(function* () {
      const lines: string[] = []
      const files: string[] = []
      let count = 0
      for (const file of MemorySchema.Sources) {
        const text = yield* memory.readSource({ root: input.root, file })
        const rows: string[] = []
        for (const raw of text.split("\n")) {
          const line = raw.trim()
          if (line.startsWith("## ")) continue
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
      const sessions = yield* memory.recent({
        root: input.root,
        limit: CATALOG_SESSION_LIMIT,
        max: CATALOG_SESSION_SUMMARY,
      })
      const sessionRows: string[] = []
      for (const item of sessions) {
        if (filter && !`${item.id} ${item.topic} ${item.summary}`.toLowerCase().includes(filter)) continue
        const date = /^\d{4}-\d{2}-\d{2}/.exec(item.time)?.[0] ?? ""
        sessionRows.push(
          `- session=${item.id}${[item.topic, date]
            .filter(Boolean)
            .map((part) => ` ${part}`)
            .join("")}`,
        )
      }
      if (sessionRows.length > 0) {
        lines.push(`## sessions`, ...sessionRows)
        count += sessionRows.length
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
        tokens: MemoryToken.estimate(input.result.output),
        operationCount: input.result.count,
        skippedCount: input.result.count ? 0 : 1,
        summary: `memory catalog listed ${input.result.count} entries`,
      },
    })
  }

  function approvalRecall(input: Recall) {
    return input.ask({
      permission: "kilo_memory_recall",
      patterns: [input.params.mode],
      always: ["*"],
      metadata: {
        mode: input.params.mode,
        ...(input.params.query ? { query: input.params.query } : {}),
        ...(input.params.sessionID ? { sessionID: input.params.sessionID } : {}),
      },
    })
  }

  function recallCatalog(input: Recall, live: Live, query: string) {
    return Effect.gen(function* () {
      const result = yield* catalog(input.memory, { root: live.root, query })
      const safe = { ...result, output: block(result.output) }
      yield* catalogAudit(input.memory, { root: live.root, current: live.current, query, result: safe })
      yield* input.memory.recordRecall({ root: live.root, sessionID: live.current, now: Date.now(), count: result.count })
      return {
        title: `Kilo memory catalog: ${result.count} entr${result.count === 1 ? "y" : "ies"}`,
        output: safe.output,
        metadata: { files: result.files, count: result.count },
      } satisfies Result
    })
  }

  function recallQuery(input: Recall, live: Live) {
    return Effect.gen(function* () {
      const output = "Provide a topic query for typed/search memory recall."
      yield* audit(input.memory, {
        root: live.root,
        params: input.params,
        current: live.current,
        hits: [],
        skipped: "missing_query",
        output,
      })
      return {
        title: `Kilo memory ${input.params.mode}: no query`,
        output,
        metadata: { files: [], count: 0 },
      } satisfies Result
    })
  }

  function recallSearch(input: Recall, live: Live, query: string, mode: MemoryRecall.Mode) {
    return Effect.gen(function* () {
      const limit = Math.max(1, Math.min(input.params.limit ?? 5, 20))
      const result = yield* input.memory.search({
        root: live.root,
        state: live.state,
        mode,
        query,
        sessionID: input.params.sessionID,
        currentSessionID: live.current,
        limit,
      })
      const hits = result?.hits ?? []
      const self = input.params.sessionID === live.current
      const skipped =
        input.params.sessionID && input.params.mode === "digest" && hits.length === 0
          ? self
            ? "current_session_digest"
            : "missing_session_digest"
          : undefined
      const output = hits.length ? result!.block : miss({ params: input.params, current: live.current })
      yield* audit(input.memory, { root: live.root, params: input.params, current: live.current, hits, skipped, output })
      yield* input.memory.recordRecall({ root: live.root, sessionID: live.current, now: Date.now(), count: hits.length })

      if (hits.length === 0) {
        return {
          title: `Kilo memory ${input.params.mode}: no results`,
          output,
          metadata: { files: [], count: 0 },
        } satisfies Result
      }

      return {
        title: `Kilo memory ${input.params.mode}: ${hits.length} hit${hits.length === 1 ? "" : "s"}`,
        output,
        metadata: { files: [...new Set(hits.map((hit) => hit.source))], count: hits.length },
      } satisfies Result
    })
  }

  export function recall(input: Recall) {
    return Effect.gen(function* () {
      const current = input.sessionID
      const root = yield* input.memory.prepare({ ctx: input.ctx })
      const status = yield* input.memory.status({ root })
      if (!status.state.enabled) return disabled(true)
      yield* approvalRecall(input)

      const live = { root, current, state: status.state }
      const query = input.params.query?.trim() ?? ""
      const mode = input.params.mode
      if (mode === "catalog") return yield* recallCatalog(input, live, query)
      if (input.params.mode !== "digest" && !query) return yield* recallQuery(input, live)
      return yield* recallSearch(input, live, query, mode)
    })
  }

  function approval(params: SaveParams, ask: Ask, input: { text?: string; query?: string }) {
    return ask({
      permission: "kilo_memory_save",
      patterns: [params.action],
      always: [],
      metadata: {
        action: params.action,
        ...(params.key ? { key: params.key } : {}),
        ...(input.text ? { text: input.text } : {}),
        ...(input.query ? { query: input.query } : {}),
      },
    })
  }

  function noQuery(): Result {
    return {
      title: "Kilo memory forget: no query",
      output: "Provide a key, id, or query text to forget.",
      metadata: { files: [] },
    }
  }

  function noText(action: SaveParams["action"]): Result {
    return {
      title: `Kilo memory ${action}: no text`,
      output: `Provide text to ${action}.`,
      metadata: { files: [] },
    }
  }

  function skipped(input: { reason: "out_of_scope" }): Result {
    return {
      title: title({ action: "skip", added: 0, removed: 0 }),
      output: skipOutput(input),
      metadata: {
        files: [],
        operationCount: 0,
        added: 0,
        removed: 0,
        skippedCount: 1,
        reason: input.reason,
      },
    }
  }

  function saved(input: { params: SaveParams; result: MemoryOperations.Result }): Result {
    const touched = files(input.params.action)
    return {
      title: title({ action: input.params.action, added: input.result.added, removed: input.result.removed }),
      output: output({
        action: input.params.action,
        count: input.result.operationCount,
        added: input.result.added,
        removed: input.result.removed,
        tokens: input.result.index.tokens,
      }),
      metadata: {
        files: touched,
        operationCount: input.result.operationCount,
        added: input.result.added,
        removed: input.result.removed,
      },
    }
  }

  function removed(input: { params: SaveParams; result: MemoryOperations.Result }) {
    return saved(input)
  }

  function skip(input: Base & { params: SaveParams }, root: string) {
    return Effect.gen(function* () {
      const reason = input.params.reason ?? "out_of_scope"
      yield* input.memory.decide({
        root,
        decision: {
          kind: "typed",
          trigger: "explicit",
          sessionID: input.sessionID,
          result: "skipped",
          llm: false,
          parsed: true,
          fallback: false,
          reason,
          tokens: 0,
          operationCount: 0,
          skippedCount: 1,
          skipped: [{ reason }],
          summary: `explicit memory save skipped: ${reason}`,
        },
      })
      return skipped({ reason })
    })
  }

  function forget(input: Save, root: string) {
    return Effect.gen(function* () {
      const query = (input.params.query ?? input.params.text ?? "").trim()
      if (!query) return noQuery()
      yield* approval(input.params, input.ask, { query })
      return removed({
        params: input.params,
        result: yield* input.memory.forget({ root, sessionID: input.sessionID, query }),
      })
    })
  }

  function write(input: Save, root: string) {
    return Effect.gen(function* () {
      const text = (input.params.text ?? "").trim()
      if (!text) return noText(input.params.action)

      yield* approval(input.params, input.ask, { text })
      const result =
        input.params.action === "correct"
          ? yield* input.memory.correct({ root, sessionID: input.sessionID, key: input.params.key, text })
          : yield* input.memory.remember({ root, sessionID: input.sessionID, key: input.params.key, text })
      return saved({ params: input.params, result })
    })
  }

  export function save(input: Save) {
    return Effect.gen(function* () {
      const root = yield* input.memory.prepare({ ctx: input.ctx })
      const status = yield* input.memory.status({ root })
      if (!status.state.enabled) return disabled()
      if (input.params.action === "forget") return yield* forget(input, root)
      if (input.params.action === "skip") return yield* skip(input, root)
      return yield* write(input, root)
    })
  }

  function files(action: SaveParams["action"]) {
    if (action === "skip") return []
    if (action === "correct") return ["corrections.md"]
    if (action === "forget") return [...MemorySchema.Sources]
    return ["project.md"]
  }

  function title(input: { action: SaveParams["action"]; added: number; removed: number }) {
    if (input.action === "skip") return "Kilo memory skipped: out of scope"
    if (input.action === "forget") return `Kilo memory updated: ${input.removed} removed`
    if (input.added === 0) return "Kilo memory unchanged"
    if (input.action === "correct")
      return `Kilo memory correction saved: ${input.added} op${input.added === 1 ? "" : "s"}`
    return `Kilo memory saved: ${input.added} op${input.added === 1 ? "" : "s"}`
  }

  function output(input: {
    action: SaveParams["action"]
    count: number
    added: number
    removed: number
    tokens: number
  }) {
    return [
      `action=${input.action}`,
      `operationCount=${input.count}`,
      `added=${input.added}`,
      `removed=${input.removed}`,
      `indexTokens=${input.tokens}`,
    ].join("\n")
  }

  function skipOutput(input: { reason: "out_of_scope" }) {
    return [`reason=${input.reason}`, "user-level memory is not supported yet."].join("\n")
  }
}
