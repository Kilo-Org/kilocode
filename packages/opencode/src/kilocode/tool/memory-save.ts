import { Effect, Schema } from "effect"
import type { MemoryOperations } from "@kilocode/kilo-memory/ops"
import { MemorySchema } from "@kilocode/kilo-memory/schema"
import { Instance } from "@/project/instance"
import * as Tool from "@/tool/tool"
import { MemoryError, type MemoryError as Failure } from "@/kilocode/memory/errors"
import { MemoryService } from "@/kilocode/memory/service"
import { ConfigProtection } from "@/kilocode/permission/config-paths"
import DESCRIPTION from "./memory-save.txt"

const Parameters = Schema.Struct({
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

type Params = Schema.Schema.Type<typeof Parameters>

export const MemorySaveTool = Tool.define(
  "kilo_memory_save",
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
              output: MemoryError.toToolOutput(err, "save"),
              metadata: { files: [] as string[] },
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

function approval(params: Params, ctx: Tool.Context, input: { text?: string; query?: string }) {
  return ctx.ask({
    permission: "kilo_memory_save",
    patterns: [params.action],
    always: [],
    metadata: {
      [ConfigProtection.DISABLE_ALWAYS_KEY]: true,
      action: params.action,
      ...(params.key ? { key: params.key } : {}),
      ...(input.text ? { text: input.text } : {}),
      ...(input.query ? { query: input.query } : {}),
    },
  })
}

function disabled() {
  return {
    title: "Kilo memory: disabled",
    output: "Kilo memory is disabled for this project.",
    metadata: { files: [] as string[] },
  }
}

function noQuery() {
  return {
    title: "Kilo memory forget: no query",
    output: "Provide a key, id, or query text to forget.",
    metadata: { files: [] as string[] },
  }
}

function noText(action: Params["action"]) {
  return {
    title: `Kilo memory ${action}: no text`,
    output: `Provide text to ${action}.`,
    metadata: { files: [] as string[] },
  }
}

function skipped(input: { reason: "out_of_scope" }) {
  return {
    title: title({ action: "skip", added: 0, removed: 0 }),
    output: skipOutput(input),
    metadata: {
      files: [] as string[],
      operationCount: 0,
      added: 0,
      removed: 0,
      skippedCount: 1,
      reason: input.reason,
    },
  }
}

function saved(input: { params: Params; result: MemoryOperations.Result }) {
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

function removed(input: { params: Params; result: MemoryOperations.Result }) {
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

function skip(memory: MemoryService.Interface, root: string, params: Params, ctx: Tool.Context) {
  return Effect.gen(function* () {
    const reason = params.reason ?? "out_of_scope"
    yield* memory.decide({
      root,
      decision: {
        kind: "typed",
        trigger: "explicit",
        sessionID: ctx.sessionID,
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

function run(memory: MemoryService.Interface, params: Params, ctx: Tool.Context) {
  return Effect.gen(function* () {
    const input = { ctx: { directory: Instance.directory, worktree: Instance.worktree } }
    const root = yield* memory.prepare(input)
    const status = yield* memory.status({ root })
    if (!status.state.enabled) return disabled()

    if (params.action === "forget") {
      const query = (params.query ?? params.text ?? "").trim()
      if (!query) return noQuery()
      yield* approval(params, ctx, { query })
      return removed({ params, result: yield* memory.forget({ root, sessionID: ctx.sessionID, query }) })
    }

    if (params.action === "skip") return yield* skip(memory, root, params, ctx)

    const text = (params.text ?? "").trim()
    if (!text) return noText(params.action)

    yield* approval(params, ctx, { text })
    const result =
      params.action === "correct"
        ? yield* memory.correct({ root, sessionID: ctx.sessionID, key: params.key, text })
        : yield* memory.remember({ root, sessionID: ctx.sessionID, key: params.key, text })
    return saved({ params, result })
  })
}

function files(action: Params["action"]) {
  if (action === "skip") return []
  if (action === "correct") return ["corrections.md"]
  if (action === "forget") return [...MemorySchema.Sources]
  return ["project.md"]
}

function title(input: { action: Params["action"]; added: number; removed: number }) {
  if (input.action === "skip") return "Kilo memory skipped: out of scope"
  if (input.action === "forget") return `Kilo memory updated: ${input.removed} removed`
  if (input.added === 0) return "Kilo memory unchanged"
  if (input.action === "correct")
    return `Kilo memory correction saved: ${input.added} op${input.added === 1 ? "" : "s"}`
  return `Kilo memory saved: ${input.added} op${input.added === 1 ? "" : "s"}`
}

function output(input: { action: Params["action"]; count: number; added: number; removed: number; tokens: number }) {
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
