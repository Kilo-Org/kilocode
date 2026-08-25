import { Effect, Option, Schema } from "effect"
import { Storage } from "@/storage/storage"

export namespace KiloBtw {
  export const MAX_ENTRIES = 20
  export const MAX_QUESTION_CHARS = 8000
  export const MAX_ANSWER_CHARS = 20000

  export const Entry = Schema.Struct({
    id: Schema.String,
    parentID: Schema.String,
    question: Schema.String,
    answer: Schema.String,
    created: Schema.Number,
    model: Schema.optional(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
      }),
    ),
    forkID: Schema.optional(Schema.String),
  })
  export type Entry = Schema.Schema.Type<typeof Entry>

  function key(parentID: string) {
    return ["btw", parentID]
  }

  function trim(text: string, max: number) {
    if (text.length <= max) return text
    return text.slice(0, max) + "\n…[truncated]"
  }

  const memFallback = new Map<string, Entry[]>()
  export const _mem = memFallback

  export function list(parentID: string) {
    return Effect.gen(function* () {
      const opt = yield* Effect.serviceOption(Storage.Service)
      if (Option.isNone(opt)) return memFallback.get(parentID) ?? ([] as Entry[])
      const storage = opt.value
      const stored = yield* storage
        .read<Entry[]>(key(parentID))
        .pipe(
          Effect.catch(() => Effect.succeed(memFallback.get(parentID) ?? ([] as Entry[]))),
        )
      // keep mem in sync for sync readers
      memFallback.set(parentID, stored)
      return stored
    })
  }

  export function listSync(parentID: string): Entry[] {
    return memFallback.get(parentID) ?? []
  }

  export function addSync(input: { parentID: string; question: string; answer: string; model?: { providerID: string; modelID: string }; forkID?: string }): Entry {
    const now = Date.now()
    const entry: Entry = {
      id: `btw_${now}_${Math.random().toString(36).slice(2, 8)}`,
      parentID: input.parentID,
      question: trim(input.question, MAX_QUESTION_CHARS),
      answer: trim(input.answer, MAX_ANSWER_CHARS),
      created: now,
      model: input.model,
      forkID: input.forkID,
    }
    const existing = memFallback.get(input.parentID) ?? []
    const next = [entry, ...existing].slice(0, MAX_ENTRIES)
    memFallback.set(input.parentID, next)
    // fire-and-forget Storage write if available (best-effort sync path)
    // async persist is handled by `add`; this keeps mem consistent for immediate listSync
    return entry
  }

  export const latest = Effect.fn("KiloBtw.latest")(function* (parentID: string) {
    const entries = yield* list(parentID)
    return entries[0]
  })

  export const add = Effect.fn("KiloBtw.add")(function* (input: {
    parentID: string
    question: string
    answer: string
    model?: { providerID: string; modelID: string }
    forkID?: string
  }) {
    const now = Date.now()
    const entry: Entry = {
      id: `btw_${now}_${Math.random().toString(36).slice(2, 8)}`,
      parentID: input.parentID,
      question: trim(input.question, MAX_QUESTION_CHARS),
      answer: trim(input.answer, MAX_ANSWER_CHARS),
      created: now,
      model: input.model,
      forkID: input.forkID,
    }
    const existingOpt = yield* Effect.serviceOption(Storage.Service)
    let existing: Entry[]
    if (Option.isSome(existingOpt)) {
      existing = yield* existingOpt.value
        .read<Entry[]>(key(input.parentID))
        .pipe(Effect.catch(() => Effect.succeed(memFallback.get(input.parentID) ?? [])))
    } else {
      existing = memFallback.get(input.parentID) ?? []
    }
    const next = [entry, ...existing].slice(0, MAX_ENTRIES)
    memFallback.set(input.parentID, next)
    if (Option.isSome(existingOpt)) {
      yield* existingOpt.value.write(key(input.parentID), next).pipe(
        Effect.catch((err) => Effect.sync(() => console.error("KiloBtw Storage write failed", err))),
      )
    }
    return entry
  })

  export const clear = Effect.fn("KiloBtw.clear")(function* (parentID: string) {
    memFallback.delete(parentID)
    const opt = yield* Effect.serviceOption(Storage.Service)
    if (Option.isNone(opt)) return
    yield* opt.value.remove(key(parentID)).pipe(Effect.ignore)
  })

  // PromptCache override so forked btw sessions reuse parent's promptCacheKey.
  // This gives cache hits on OpenAI/Codex/xAI/Mistral which key by sessionID.
  // Anthropic already hits via prefix, but reusing is still correct.
  const overrides = ((globalThis as any).__KILO_BTW_OVERRIDES__ as Map<string, string> | undefined) ?? ((globalThis as any).__KILO_BTW_OVERRIDES__ = new Map<string, string>())

  export function setPromptCacheOverride(forkID: string, parentID: string) {
    overrides.set(forkID, parentID)
  }

  export function getPromptCacheOverride(sessionID: string): string | undefined {
    return overrides.get(sessionID)
  }

  export function clearPromptCacheOverride(sessionID: string) {
    overrides.delete(sessionID)
  }

  export function resolvePromptCacheKey(sessionID: string): string {
    return overrides.get(sessionID) ?? sessionID
  }

  export function formatEntry(entry: Entry): string {
    const when = new Date(entry.created).toISOString()
    const model = entry.model ? `${entry.model.providerID}/${entry.model.modelID}` : "unknown model"
    return [`Q (${when} · ${model}): ${entry.question}`, "", `A: ${entry.answer}`].join("\n")
  }

  export function formatUsage(): string {
    return [
      "Usage: /btw <question>",
      "Ask a side question without adding to the main conversation.",
      "The question runs in a temporary fork with the current cached context, then the fork is deleted.",
      "Run /btw with no arguments to see your most recent side question.",
    ].join("\n")
  }
}
