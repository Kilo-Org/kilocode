import { InstanceState } from "@/effect/instance-state"
import { IdeLsp, HostError } from "@/kilocode/ide-lsp/service"
import { Operation, type Entry, type Result } from "@/kilocode/ide-lsp/protocol"
import * as Tool from "@/tool/tool"
import { Effect, Schema } from "effect"
import path from "path"
import DESCRIPTION from "./ide-lsp.txt"

const Line = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const Params = Schema.Struct({
  operation: Operation.annotate({ description: "The code-intelligence operation" }),
  filePath: Schema.String.annotate({ description: "Absolute or workspace-relative file path" }),
  line: Schema.optional(Line).annotate({ description: "1-based line (not needed for workspaceSymbol)" }),
  character: Schema.optional(Line).annotate({ description: "1-based column (not needed for workspaceSymbol)" }),
  query: Schema.optional(Schema.String).annotate({ description: "Symbol query for workspaceSymbol" }),
})

function abort(signal: AbortSignal) {
  return Effect.callback<never, HostError>((resume) => {
    const err = () => new HostError({ code: "cancelled", detail: "The IDE code intelligence tool call was cancelled" })
    if (signal.aborted) return resume(Effect.fail(err()))
    const handler = () => resume(Effect.fail(err()))
    signal.addEventListener("abort", handler, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", handler))
  })
}

function run(effect: Effect.Effect<Result, HostError>, signal: AbortSignal) {
  return effect.pipe(Effect.raceFirst(abort(signal)), Effect.orDie)
}

function label(entry: Entry) {
  return [entry.kind, entry.name].filter(Boolean).join(" ")
}

function format(entry: Entry, index?: number) {
  const prefix = index === undefined ? "-" : `${index}.`
  const title = label(entry)
  const head = `${prefix} ${entry.filePath}:${entry.startLine}-${entry.endLine}${title ? `  ${title}` : ""}`
  return entry.preview ? `${head}\n${entry.preview}` : head
}

function section(title: string, entries: readonly Entry[]) {
  if (entries.length === 0) return `${title}: no results`
  return [`${title}:`, ...entries.map((entry, index) => format(entry, index + 1))].join("\n")
}

function render(result: Result) {
  if (result.indexing) return "The IDE is still indexing. Retry shortly or fall back to grep/glob/read for text search."
  if (result.operation === "typeHierarchy") {
    return [
      section("Supertypes", result.supertypes ?? []),
      section("Subtypes", result.subtypes ?? []),
      result.entries.length ? section("Element", result.entries) : undefined,
    ]
      .filter(Boolean)
      .join("\n\n")
  }
  if (result.entries.length === 0) return `No results found for ${result.operation}`
  return result.entries.map((entry, index) => format(entry, index + 1)).join("\n")
}

export const IdeCodeIntelTool = Tool.define<
  typeof Params,
  { operation: string },
  IdeLsp.Service,
  "ide_code_intel"
>(
  "ide_code_intel",
  Effect.gen(function* () {
    const ide = yield* IdeLsp.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const dir = yield* InstanceState.directory
          const file = path.isAbsolute(params.filePath) ? params.filePath : path.join(dir, params.filePath)
          const result = yield* run(
            ide.request({
              operation: params.operation,
              sessionID: ctx.sessionID,
              filePath: file,
              line: params.line,
              character: params.character,
              query: params.query,
            }),
            ctx.abort,
          )
          if (result.operation !== params.operation)
            return yield* Effect.die(new Error("IDE code intelligence host returned the wrong result type"))
          return {
            title: `ide_code_intel: ${params.operation}`,
            output: render(result),
            metadata: { operation: params.operation },
          }
        }),
    }
  }),
)
