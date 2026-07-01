import { Cause, Effect } from "effect"
import {
  auditOps,
  cap,
  capturePlan,
  digestPrompt,
  digestSchema,
  duplicateOps,
  errorReason,
  evidence,
  fallbackDigest,
  guardReason,
  hasDurableDiff,
  mergeOps,
  notice,
  parseDigest,
  parseJson,
  parseOps,
  skipped,
  summarize,
  summarizeDiffs,
  typedPrompt,
  typedSchema,
  usage,
  verifySkips,
  type CaptureReason,
  type CaptureSkip,
  type CaptureSourceItem,
} from "../capture/capture"
import { MemoryDigest } from "../capture/digest"
import type { MemoryOperations } from "../capture/ops"
import { MemoryRedact } from "../capture/redact"
import { MemorySchema } from "../schema"
import { MemoryShared } from "../recall/shared"
import { MemoryEvents } from "./events"
import { MemoryLog } from "./log"
import type { MemoryPorts } from "./ports"
import { MemoryService } from "./service"
import { MemoryTimers } from "./timers"

const MESSAGE_WINDOW = 24

/** Heuristic: an assistant answer that mostly restates injected instructions/source files is not
 * durable project memory and should not be consolidated. */
function provenance(input: { assistant: string }) {
  const assistant = input.assistant.trim()
  const markers = [/\bsystem\s*\/\s*developer\b/gi, /\bagents\.md\b/gi, /\bclaude\.md\b/gi].reduce(
    (sum, item) => sum + (assistant.match(item)?.length ?? 0),
    0,
  )
  const list = assistant.split("\n").filter((line) => /^\s*[-*]\s+\S/.test(line)).length
  return markers >= 4 || (markers >= 3 && list >= 2)
}

function typedExisting(memory: MemoryService.Interface, root: string) {
  return memory.sources({ root }).pipe(
    Effect.map((sources) => {
      const blocks = MemorySchema.Sources.map((file) => {
        const body = sources[file].trim()
        if (!body) return ""
        return [`### source ${file}`, body].join("\n")
      })
      return blocks.filter(Boolean).join("\n")
    }),
  )
}

function itemSource(file: MemorySchema.Source, text: string): CaptureSourceItem[] {
  return MemoryShared.source({ file, text })
}

function typedItems(memory: MemoryService.Interface, root: string) {
  return memory
    .sources({ root })
    .pipe(Effect.map((sources) => MemorySchema.Sources.flatMap((file) => itemSource(file, sources[file]))))
}

export namespace MemoryCapture {
  export const turn = Effect.fn("MemoryCapture.turn")(function* (input: {
    root: string
    sessionID: string
    session: MemoryPorts.SessionPort
    model: MemoryPorts.ModelPort
    reason?: CaptureReason
    bypassInterval?: boolean
    memoryModel?: string
  }) {
    const root = input.root
    // Acquire first (sync, cannot fail) so the matching `release` in the finalizer below always pairs
    // with this acquire regardless of where the turn exits.
    const signal = MemoryTimers.signal(root)
    const memory = yield* MemoryService.Service
    yield* memory.prepare({ root })
    const state = yield* memory.state({ root })
    const reported = new Set<string>()
    const fail = (reason: string) =>
      Effect.promise(async () => {
        const safe = MemoryRedact.text(reason)
        if (reported.has(safe)) return
        reported.add(safe)
        await MemoryEvents.publish({
          event: "error",
          payload: MemoryEvents.status({
            root,
            state,
            phase: "error",
            reason: safe,
            sessionID: input.sessionID,
          }),
        })
      })
    const skip = (reason: string, opts?: { idleFlush?: boolean }) =>
      Effect.gen(function* () {
        if (state.enabled) yield* memory.decide({ root, decision: skipped({ sessionID: input.sessionID, reason }) })
        yield* Effect.promise(() =>
          MemoryEvents.publish({
            event: "status",
            payload: MemoryEvents.status({
              root,
              state,
              phase: "skipped",
              reason,
              sessionID: input.sessionID,
            }),
          }),
        )
        return { root, skipped: true as const, reason, idleFlush: opts?.idleFlush === true }
      })
    if (!state.enabled || !state.capture.turnClose) return yield* skip("disabled")
    const now = Date.now()
    const view = yield* input.session.readTurn({ sessionID: input.sessionID, window: MESSAGE_WINDOW })
    if (!view) return yield* skip("no_turn")
    if (input.bypassInterval && state.stats.lastConsolidatedMessageID === view.lastAssistantID)
      return yield* skip("no_new_content")
    const user = view.user
    const assistant = view.assistant
    const recent = view.recent
    const summary = summarize({ user, assistant, max: state.limits.maxSessionLineChars })
    const diffs = view.diffs
    const changed = summarizeDiffs(diffs)
    const durable = hasDurableDiff(diffs)
    const completed = !input.reason || input.reason === "completed"
    // Echo = short lookup answered from memory with no file changes. Long recall-assisted answers
    // (research, investigations) carry new content and must still be digested.
    const echo = !durable && assistant.length < 1200 && view.recalledMemory
    const sourced = provenance({ assistant })
    const session = completed && !echo && Boolean(summary)
    const prior = session
      ? yield* memory.session({ root, sessionID: input.sessionID, max: state.limits.maxSessionLineChars })
      : undefined
    const priorTime = prior?.time ? Date.parse(prior.time) : 0
    const plan = capturePlan({
      reason: input.reason,
      summary,
      echo,
      durable,
      priorTime,
      now,
      minIntervalMs: state.capture.minIntervalMs,
      lastConsolidatedAt: state.stats.lastConsolidatedAt,
      bypassInterval: input.bypassInterval,
      autoConsolidate: state.autoConsolidate,
    })
    const digestDue = plan.digestDue
    const typedCall = plan.typedCall

    if (plan.skipReason) return yield* skip(plan.skipReason, plan.idleFlush ? { idleFlush: true } : undefined)
    yield* Effect.promise(() =>
      MemoryEvents.publish({
        event: "status",
        payload: MemoryEvents.status({ root, state, phase: "checking", sessionID: input.sessionID }),
      }),
    )

    const model =
      digestDue || typedCall
        ? yield* Effect.gen(function* () {
            const resolution = yield* input.model.resolve({
              configured: input.memoryModel,
              session: view.sessionModel,
            })
            if (resolution.fallback) {
              yield* memory.append({
                root,
                text: `memory_model_config reason=${MemoryShared.brief(
                  MemoryRedact.text(resolution.fallback.reason),
                  160,
                )} fallback=1`,
              })
            }
            return resolution.handle
          })
        : undefined
    const fallback = MemoryRedact.text(
      fallbackDigest({ prior: prior?.summary, summary, max: state.limits.maxSessionLineChars }),
    )
    const safe = MemoryDigest.empty(fallback) ? "" : fallback
    const digestEffect = digestDue
      ? Effect.gen(function* () {
          const body = cap(
            evidence([
              { title: "latest_user", body: user },
              { title: "latest_assistant", body: assistant || "(no assistant text)" },
              { title: "diff_summary", body: changed || "(none)" },
              { title: "previous_digest", body: prior?.summary },
              { title: "max_characters", body: String(state.limits.maxSessionLineChars) },
            ]),
            state.limits.maxConsolidationInputBytes,
          )
          const result = yield* Effect.tryPromise({
            try: () =>
              input.model.run({
                handle: model!,
                system: digestPrompt,
                prompt: body,
                timeoutMs: state.capture.timeoutMs,
                signal,
              }),
            catch: (error) => error,
          }).pipe(
            Effect.map((result) => ({ ok: true as const, result })),
            Effect.catch((err: unknown) =>
              Effect.gen(function* () {
                if (signal.aborted) return { ok: false as const, reason: "cancelled" }
                const raw = errorReason(err)
                const reason = MemoryRedact.text(guardReason(raw) ?? raw)
                yield* fail(reason)
                yield* memory.append({ root, text: `digest error=${MemoryShared.brief(reason, 160)} fallback=1` })
                return { ok: false as const, reason }
              }),
            ),
          )
          if (!result.ok) {
            return {
              topic: "",
              summary: safe,
              tokens: 0,
              reason: result.reason,
            }
          }
          const parsed = yield* Effect.try({
            try: () => parseJson(digestSchema, result.result.text),
            catch: (error) => error,
          }).pipe(
            Effect.catch((err: unknown) =>
              Effect.gen(function* () {
                const reason = MemoryRedact.text(errorReason(err))
                yield* fail("digest parse_error")
                yield* memory.append({
                  root,
                  text: `digest parse_error=${MemoryShared.brief(reason, 160)} fallback=1`,
                })
                return undefined
              }),
            ),
          )
          if (!parsed) {
            return { topic: "", summary: safe, tokens: usage(result.result.usage), reason: "parse_error" }
          }
          const parsedDigest = parseDigest(parsed, fallback, state.limits.maxSessionLineChars)
          return {
            topic: MemoryRedact.text(parsedDigest.topic),
            summary: MemoryRedact.text(parsedDigest.summary),
            tokens: usage(result.result.usage),
            reason: undefined as string | undefined,
          }
        })
      : Effect.succeed({
          topic: "",
          summary: "",
          tokens: 0,
          reason: undefined as string | undefined,
        })
    const typedEffect = typedCall
      ? Effect.gen(function* () {
          if (sourced) {
            return {
              ops: [] as MemoryOperations.Op[],
              tokens: 0,
              fallback: false,
              reason: undefined as string | undefined,
              skipped: [
                {
                  reason: "out_of_scope" as const,
                  text: "Instruction/source provenance answers are not durable project memory.",
                },
              ] satisfies CaptureSkip[],
              fallbackOperationCount: 0,
            }
          }
          const existing = yield* typedExisting(memory, root)
          const items = yield* typedItems(memory, root)
          const sessions = yield* memory.recent({
            root,
            limit: state.limits.maxSessionFiles,
            max: state.limits.maxSessionLineChars,
          })
          const body = cap(
            evidence([
              { title: "close_reason", body: input.reason ?? "completed" },
              { title: "latest_user", body: user },
              { title: "latest_assistant", body: assistant || "(no assistant text)" },
              { title: "diff_summary", body: changed || "(none)" },
              { title: "existing_memory", body: existing },
              { title: "recent_session_context", body: recent },
              {
                title: "recent_memory_digests",
                body: sessions
                  .map((item) => `${item.file} session=${item.id} ${item.time} :: ${item.summary}`)
                  .join("\n"),
              },
            ]),
            state.limits.maxConsolidationInputBytes,
          )
          const result = yield* Effect.tryPromise({
            try: () =>
              input.model.run({
                handle: model!,
                system: typedPrompt,
                prompt: body,
                timeoutMs: state.capture.timeoutMs,
                signal,
              }),
            catch: (error) => error,
          }).pipe(
            Effect.map((result) => ({ ok: true as const, result })),
            Effect.catch((err: unknown) =>
              Effect.gen(function* () {
                if (signal.aborted) return { ok: false as const, reason: "cancelled" }
                const raw = errorReason(err)
                const reason = MemoryRedact.text(guardReason(raw) ?? raw)
                yield* fail(reason)
                yield* memory.append({ root, text: `consolidate error=${MemoryShared.brief(reason, 160)}` })
                return { ok: false as const, reason }
              }),
            ),
          )
          if (!result.ok) {
            return {
              ops: [] as MemoryOperations.Op[],
              tokens: 0,
              fallback: true,
              reason: result.reason,
              skipped: [] as CaptureSkip[],
              fallbackOperationCount: 0,
            }
          }
          const parsed = yield* Effect.try({
            try: () => parseJson(typedSchema, result.result.text),
            catch: (error) => error,
          }).pipe(
            Effect.catch((err: unknown) =>
              Effect.gen(function* () {
                const reason = MemoryRedact.text(errorReason(err))
                yield* fail("consolidate parse_error")
                yield* memory.append({ root, text: `consolidate parse_error=${MemoryShared.brief(reason, 160)}` })
                return undefined
              }),
            ),
          )
          if (!parsed) {
            return {
              ops: [] as MemoryOperations.Op[],
              tokens: usage(result.result.usage),
              fallback: true,
              reason: "parse_error",
              skipped: [] as CaptureSkip[],
              fallbackOperationCount: 0,
            }
          }
          const verified = verifySkips({ skipped: parsed.skipped, items })
          const deduped = duplicateOps({ ops: parseOps(parsed), skipped: verified.skipped, items })
          return {
            ops: deduped.ops,
            tokens: usage(result.result.usage),
            fallback: false,
            reason: undefined as string | undefined,
            skipped: deduped.skipped,
            fallbackOperationCount: 0,
          }
        })
      : Effect.succeed({
          ops: [] as MemoryOperations.Op[],
          tokens: 0,
          fallback: false,
          reason: undefined as string | undefined,
          skipped: [] as CaptureSkip[],
          fallbackOperationCount: 0,
        })
    // Digest and typed consolidation are independent model calls; run them concurrently.
    const [digest, generated] = yield* Effect.all([digestEffect, typedEffect], { concurrency: 2 })
    if (signal.aborted) return yield* skip("cancelled")
    if (digest.summary) {
      yield* memory.recordSession({
        root,
        sessionID: input.sessionID,
        topic: digest.topic,
        summary: digest.summary,
        time: now,
        tokens: digest.tokens,
      })
    }
    if (digestDue) {
      yield* memory.decide({
        root,
        decision: {
          kind: "digest",
          trigger: "turn-close",
          sessionID: input.sessionID,
          result: digest.reason ? "fallback" : digest.summary ? "saved" : "skipped",
          llm: true,
          parsed: Boolean(digest.summary && !digest.reason),
          fallback: Boolean(digest.reason),
          reason: digest.reason,
          tokens: digest.tokens,
          operationCount: digest.summary ? 1 : 0,
          skippedCount: digest.summary ? 0 : 1,
          summary: digest.reason
            ? `session digest used fallback after ${digest.reason}`
            : digest.summary
              ? "session digest saved"
              : "session digest skipped",
        },
      })
    }

    const ops = mergeOps(generated.ops)
      .filter((item) => item.action !== "remove")
      .slice(0, state.capture.maxOpsPerRun)
    const project =
      ops.length > 0 ? yield* memory.apply({ root, ops, trigger: "turn-close", tokens: generated.tokens }) : undefined
    const count = project?.operationCount ?? 0
    if (typedCall) {
      yield* memory.decide({
        root,
        decision: {
          kind: "typed",
          trigger: "turn-close",
          sessionID: input.sessionID,
          result: generated.fallback ? "fallback" : count > 0 ? "saved" : "skipped",
          llm: true,
          parsed: !generated.fallback,
          fallback: generated.fallback,
          reason: generated.reason,
          tokens: generated.tokens,
          operationCount: count,
          skippedCount: generated.skipped.length,
          fallbackOperationCount: generated.fallbackOperationCount,
          skipped: generated.skipped,
          operations: auditOps(ops),
          files: [...new Set(ops.flatMap((item) => (item.action === "add" && item.file ? [item.file] : [])))],
          summary: generated.fallback
            ? `typed consolidation skipped after ${generated.reason ?? "model failure"}`
            : count > 0
              ? `typed consolidation saved ${count} ops`
              : `typed consolidation skipped ${generated.skipped.length} candidates`,
        },
      })
    }
    const tokens = digest.tokens + generated.tokens
    if (!digest.summary && !typedCall && count === 0) return yield* skip("no_ops")
    if ((digestDue || typedCall || count > 0) && (!typedCall || !generated.fallback)) {
      yield* memory.commit({
        root,
        now,
        messageID: view.lastAssistantID,
        tokens,
        count,
        digest: Boolean(digest.summary),
        skipped: generated.skipped,
      })
    }
    const updated = yield* memory.state({ root })
    const index = project?.index ?? (yield* memory.index({ root }))
    const detail = typedCall
      ? notice({
          count,
          ops,
          skipped: generated.skipped,
          tokens: generated.tokens,
        })
      : undefined
    yield* Effect.promise(() =>
      MemoryEvents.publish({
        event: "status",
        payload: MemoryEvents.status({
          root,
          state: updated,
          index,
          phase: "idle",
          sessionID: input.sessionID,
          consolidation: { trigger: "turn-close", operationCount: count, cost: 0, tokens },
          ...(detail ? { detail } : {}),
        }),
      }),
    )
    return { root, skipped: false as const, operationCount: count, tokens }
  },
  // Release the per-root abort controller acquired at the top once the turn settles (any exit path).
  (effect, input) => effect.pipe(Effect.ensuring(Effect.sync(() => MemoryTimers.release(input.root)))))

  export function report(cause: Cause.Cause<unknown>) {
    // Brief message only: API errors carry response headers/bodies that would flood the host log.
    const err = Cause.squash(cause)
    MemoryLog.warn("memory capture failed", {
      err: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    })
  }
}
