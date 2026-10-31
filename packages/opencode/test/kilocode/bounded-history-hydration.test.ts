import { describe, expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectSchema } from "@opencode-ai/core/project/schema"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { KiloSessionPromptQueue } from "../../src/kilocode/session/prompt-queue"
import { KiloSessionMessageOrder } from "../../src/kilocode/session/message-order"
import type { Provider } from "../../src/provider/provider"
import { testEffect } from "../lib/effect"
import { fullHistory } from "./history-baseline"

const it = testEffect(LayerNode.compile(MessageV2.node))
const model = {
  id: ModelV2.ID.make("test"),
  providerID: ProviderV2.ID.make("test"),
  api: { id: "test", url: "https://example.invalid", npm: "@ai-sdk/anthropic" },
} as Provider.Model

function fixture(sessionID: SessionID) {
  const messages: MessageV2.WithParts[] = []
  function user(text = "hello", time = messages.length) {
    const id = MessageID.make(`msg_${String(messages.length).padStart(6, "0")}`)
    const message: MessageV2.WithParts = {
      info: {
        id, sessionID, role: "user", time: { created: time }, agent: "test",
        model: { providerID: model.providerID, modelID: model.id },
      },
      parts: [{ id: PartID.make(`prt_${id}_text`), sessionID, messageID: id, type: "text", text }],
    }
    messages.push(message)
    return message
  }
  function assistant(parent: MessageV2.WithParts, opts: Partial<MessageV2.Assistant> = {}) {
    const id = MessageID.make(`msg_${String(messages.length).padStart(6, "0")}`)
    const message: MessageV2.WithParts = {
      info: {
        id, sessionID, role: "assistant", parentID: parent.info.id, time: { created: messages.length },
        agent: "test", mode: "test", modelID: model.id, providerID: model.providerID,
        path: { cwd: "/", root: "/" }, cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop", ...opts,
      },
      parts: [{ id: PartID.make(`prt_${id}_text`), sessionID, messageID: id, type: "text", text: "reply ü" }],
    }
    messages.push(message)
    return message
  }
  function compact(tail?: MessageV2.WithParts, opts: Partial<MessageV2.Assistant> = {}) {
    const parent = user()
    parent.parts = [{
      id: PartID.make(`prt_${parent.info.id}_compact`), sessionID, messageID: parent.info.id,
      type: "compaction", auto: true, ...(tail ? { tail_start_id: tail.info.id } : {}),
    }]
    assistant(parent, { summary: true, ...opts })
    return parent
  }
  return { messages, user, assistant, compact }
}

function seed(sessionID: SessionID, messages: MessageV2.WithParts[]) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const project = ProjectSchema.ID.make("project_hydration")
    yield* db.insert(ProjectTable).values({
      id: project, worktree: AbsolutePath.make("/"), sandboxes: [],
    }).onConflictDoNothing()
    yield* db.insert(SessionTable).values({
      id: sessionID, project_id: project, slug: "hydration", directory: "/", title: "synthetic", version: "test",
    })
    for (let index = 0; index < messages.length; index += 50) {
      const slice = messages.slice(index, index + 50)
      yield* db.insert(MessageTable).values(slice.map((message) => {
        const { id, sessionID, ...data } = message.info
        return { id, session_id: sessionID, time_created: data.time.created, data }
      }))
      const parts = slice.flatMap((message) => message.parts.map((part) => {
        const { id, sessionID, messageID, ...data } = part
        return { id, session_id: sessionID, message_id: messageID, data }
      }))
      if (parts.length) yield* db.insert(PartTable).values(parts)
    }
  })
}

const project = (sessionID: SessionID) => (messages: MessageV2.WithParts[]) =>
  KiloSessionPrompt.trimBeforeLastSummary(KiloSessionPromptQueue.scope(sessionID, messages))

function compare(sessionID: SessionID) {
  return Effect.gen(function* () {
    const full = project(sessionID)(yield* fullHistory(sessionID))
    const bounded = project(sessionID)(yield* MessageV2.filterCompactedEffect(sessionID))
    expect(Buffer.from(JSON.stringify(bounded))).toEqual(Buffer.from(JSON.stringify(full)))
    expect(KiloSessionMessageOrder.latest(bounded)).toEqual(KiloSessionMessageOrder.latest(full))
    const old = yield* MessageV2.toModelMessagesEffect(KiloSessionPrompt.maybeStripHistoricalMedia(full), model)
    const next = yield* MessageV2.toModelMessagesEffect(KiloSessionPrompt.maybeStripHistoricalMedia(bounded), model)
    expect(Buffer.from(JSON.stringify(next))).toEqual(Buffer.from(JSON.stringify(old)))
    return { full, bounded, bytes: Buffer.byteLength(JSON.stringify(next)) }
  })
}

// Adapted from the prior local lazy-history tests: verify exact page edges and an assistant tail.
function observedDatabase(database: Database.Interface) {
  const reads: { table: unknown; rows: number; bytes: number }[] = []
  const db = new Proxy(database.db, {
    get(target, key) {
      const value = Reflect.get(target, key, target)
      if (key !== "select") return typeof value === "function" ? value.bind(target) : value
      return (...args: unknown[]) => {
        let table: unknown
        function track(builder: object): object {
          return new Proxy(builder, {
            get(target, key) {
              const value = Reflect.get(target, key, target)
              if (key === "all") return (...args: unknown[]) => value.apply(target, args).pipe(
                Effect.tap((rows: unknown[]) => Effect.sync(() => {
                  reads.push({ table, rows: rows.length, bytes: Buffer.byteLength(JSON.stringify(rows)) })
                })),
              )
              if (typeof value !== "function") return value
              return (...args: unknown[]) => {
                if (key === "from") table = args[0]
                const next = value.apply(target, args)
                return next && typeof next === "object" ? track(next) : next
              }
            },
          })
        }
        return track(value.apply(target, args))
      }
    },
  })
  return { service: { db }, reads }
}

describe("bounded history hydration", () => {
  for (const shape of ["none", "one", "several", "tail", "manual", "unfinished", "error", "missing-tail", "self-tail", "missing-parent", "tie", "reverted", "forked", "queue"]) {
    it.live(`matches full-load model bytes: ${shape}`, () => Effect.gen(function* () {
      const sessionID = SessionID.make(`ses_hydration_${shape}`)
      const f = fixture(sessionID)
      for (let i = 0; i < 121; i++) f.assistant(f.user(`old ${i}`))
      if (shape === "one" || shape === "reverted" || shape === "tie" || shape === "forked" || shape === "queue") f.compact()
      if (shape === "several") { f.compact(); f.assistant(f.user()); f.compact() }
      if (shape === "tail") {
        const tail = f.user("retained")
        for (let i = 0; i < 60; i++) f.assistant(f.user())
        f.compact(tail)
      }
      if (shape === "manual") f.assistant(f.user("manual summary parent"), { summary: true })
      if (shape === "unfinished") f.compact(undefined, { finish: undefined })
      if (shape === "error") f.compact(undefined, { error: new MessageV2.APIError({ message: "synthetic", isRetryable: false }).toObject() })
      if (shape === "missing-tail") f.compact({ ...f.messages[0], info: { ...f.messages[0].info, id: MessageID.make("msg_absent") } })
      if (shape === "self-tail") {
        const parent = f.compact()
        const part = parent.parts[0]
        if (part.type === "compaction") part.tail_start_id = parent.info.id
      }
      if (shape === "missing-parent") {
        f.assistant(f.user(), { summary: true, parentID: MessageID.make("msg_absent") })
      }
      const user = f.user("latest")
      const assistant = f.assistant(user, { finish: "tool-calls" })
      const base = { id: PartID.make("prt_pending"), sessionID, messageID: assistant.info.id }
      assistant.parts.push({
        ...base, type: "tool", callID: "pending", tool: "read",
        state: { status: "pending", input: { file: "x" }, raw: "" },
      })
      assistant.parts.push({ ...base, id: PartID.make("prt_snapshot"), type: "step-start", snapshot: "synthetic" })
      assistant.parts.push({
        ...base, id: PartID.make("prt_reasoning"), type: "reasoning", text: "reasoning",
        metadata: { anthropic: { signature: "synthetic-signature" } },
      })
      assistant.parts.push({
        ...base, id: PartID.make("prt_running"), type: "tool", callID: "running", tool: "read",
        state: { status: "running", input: { file: "x" }, time: { start: 0 } },
      })
      assistant.parts.push({
        ...base, id: PartID.make("prt_error"), type: "tool", callID: "error", tool: "read",
        state: { status: "error", input: { file: "x" }, error: "synthetic error", time: { start: 0, end: 1 } },
      })
      user.parts.push({
        ...base, id: PartID.make("prt_image"), messageID: user.info.id,
        type: "file", mime: "image/png", url: "data:image/png;base64,aGVsbG8=", filename: "current.png",
      })
      if (shape === "tie") for (const message of f.messages) message.info.time.created = 10
      // Revert cleanup deletes the reverted suffix before runLoop hydrates it.
      if (shape === "reverted") f.messages.splice(-2)
      const later = shape === "queue" ? f.user("LATER QUEUED USER") : undefined
      if (later) f.assistant(later)
      yield* seed(sessionID, f.messages)
      if (shape === "forked") {
        const child = SessionID.make("ses_hydration_child")
        const mapping = new Map(f.messages.map((message) => [message.info.id, MessageID.make(`msg_fork_${message.info.id}`)]))
        const copied = f.messages.map((message): MessageV2.WithParts => ({
          info: {
            ...message.info, id: mapping.get(message.info.id)!, sessionID: child,
            ...(message.info.role === "assistant" ? { parentID: mapping.get(message.info.parentID)! } : {}),
          },
          parts: message.parts.map((part) => ({
            ...part, id: PartID.make(`prt_fork_${part.id}`), sessionID: child, messageID: mapping.get(part.messageID)!,
            ...(part.type === "compaction" && part.tail_start_id ? { tail_start_id: mapping.get(part.tail_start_id) } : {}),
          })),
        }))
        yield* seed(child, copied)
        yield* compare(child)
        yield* (yield* Database.Service).db.delete(SessionTable).where(eq(SessionTable.id, child))
      }
      if (shape === "queue") {
        expect(later!.info.id > user.info.id).toBe(true)
        yield* KiloSessionPromptQueue.enqueue(sessionID, user.info.id, Effect.gen(function* () {
          const result = yield* compare(sessionID)
          expect(result.bounded.some((message) => message.info.id === later!.info.id)).toBe(false)
          expect(result.bounded.some((message) => message.info.id === user.info.id)).toBe(true)
        }), Effect.die("unexpected cancellation"))
        yield* (yield* Database.Service).db.delete(SessionTable).where(eq(SessionTable.id, sessionID))
        return
      }
      // The prior patch also asserted traversal, not just output, for these boundary cases.
      const pages: Record<string, number> = { none: 5, unfinished: 5, error: 5, "missing-tail": 5, "self-tail": 1 }
      if (shape in pages) {
        const observed = observedDatabase(yield* Database.Service)
        yield* MessageV2.filterCompactedEffect(sessionID).pipe(
          Effect.provideService(Database.Service, observed.service),
        )
        expect(observed.reads.filter((read) => read.table === MessageTable)).toHaveLength(pages[shape])
      }
      yield* compare(sessionID)
      yield* (yield* Database.Service).db.delete(SessionTable).where(eq(SessionTable.id, sessionID))
    }))
  }

  for (const shape of ["boundary-page-edge", "assistant-tail", "empty"]) {
    it.live(`preserves prior lazy-history coverage: ${shape}`, () => Effect.gen(function* () {
      const sessionID = SessionID.make(`ses_hydration_prior_${shape}`)
      const f = fixture(sessionID)
      let expected: MessageID[] = []
      let queries = 1
      if (shape === "boundary-page-edge") {
        for (let i = 0; i < 120; i++) f.user()
        f.compact()
        for (let i = 0; i < 10; i++) f.user()
        const parent = f.compact()
        for (let i = 0; i < 48; i++) f.user()
        expected = f.messages.slice(f.messages.indexOf(parent)).map((message) => message.info.id)
        expect(f.messages).toHaveLength(182)
      }
      if (shape === "assistant-tail") {
        for (let i = 0; i < 120; i++) f.user()
        f.compact()
        const tail = f.assistant(f.user("retained parent"))
        for (let i = 0; i < 70; i++) f.user()
        const parent = f.compact(tail)
        for (let i = 0; i < 10; i++) f.user()
        expected = [
          ...f.messages.slice(f.messages.indexOf(parent), f.messages.indexOf(parent) + 2),
          ...f.messages.slice(f.messages.indexOf(tail), f.messages.indexOf(parent)),
          ...f.messages.slice(-10),
        ].map((message) => message.info.id)
        queries = 2
      }
      yield* seed(sessionID, f.messages)
      const observed = observedDatabase(yield* Database.Service)
      const selected = project(sessionID)(yield* MessageV2.filterCompactedEffect(sessionID).pipe(
        Effect.provideService(Database.Service, observed.service),
      ))
      expect(selected.map((message) => message.info.id)).toEqual(expected)
      expect(observed.reads.filter((read) => read.table === MessageTable)).toHaveLength(queries)
      if (shape === "boundary-page-edge") {
        expect(observed.reads.filter((read) => read.table === MessageTable).map((read) => read.rows)).toEqual([51])
        expect(observed.reads.filter((read) => read.table === PartTable).reduce((sum, read) => sum + read.rows, 0)).toBe(50)
      }
      yield* compare(sessionID)
      yield* (yield* Database.Service).db.delete(SessionTable).where(eq(SessionTable.id, sessionID))
    }))
  }

  it.live("measures returned database rows and bytes without model calls", () => Effect.gen(function* () {
    const sessionID = SessionID.make("ses_hydration_measurement")
    const f = fixture(sessionID)
    for (let i = 0; i < 3000; i++) {
      f.assistant(f.user("x".repeat(2048)))
      if (i === 999 || i === 1999 || i === 2899) f.compact()
    }
    yield* seed(sessionID, f.messages)
    const database = yield* Database.Service
    const counts = { rows: 0, bytes: 0 }
    const wrapped = new Proxy(database.db, {
      get(target, key) {
        const value = Reflect.get(target, key, target)
        if (key !== "select") return typeof value === "function" ? value.bind(target) : value
        return (...args: unknown[]) => {
          const query = value.apply(target, args)
          function track(builder: object): object {
            return new Proxy(builder, {
              get(target, key) {
                const value = Reflect.get(target, key, target)
                if (key === "all") return (...args: unknown[]) => value.apply(target, args).pipe(Effect.tap((rows: unknown[]) => Effect.sync(() => {
                  counts.rows += rows.length
                  counts.bytes += Buffer.byteLength(JSON.stringify(rows))
                })))
                if (typeof value !== "function") return value
                return (...args: unknown[]) => {
                  const next = value.apply(target, args)
                  return next && typeof next === "object" ? track(next) : next
                }
              },
            })
          }
          return track(query)
        }
      },
    })
    const measured = { db: wrapped }
    const start = performance.now()
    const full = yield* MessageV2.stream(sessionID).pipe(Effect.provideService(Database.Service, measured))
    const old = { ...counts, ms: performance.now() - start }
    counts.rows = 0; counts.bytes = 0
    const begin = performance.now()
    const bounded = project(sessionID)(yield* MessageV2.filterCompactedEffect(sessionID).pipe(Effect.provideService(Database.Service, measured)))
    const next = { ...counts, ms: performance.now() - begin }
    expect(Buffer.from(JSON.stringify(bounded))).toEqual(Buffer.from(JSON.stringify(project(sessionID)(MessageV2.filterCompacted(full)))))
    expect(next.bytes).toBeLessThan(old.bytes / 10)
    console.log(JSON.stringify({ measurement: "driver-returned rows and UTF-8 JSON bytes; not physical disk I/O", messages: f.messages.length, old, next }))
  }))

  for (const shape of ["none", "manual", "auto", "media-boundary"] as const) {
    it.live(`paged history cost and contention: ${shape}`, () => Effect.gen(function* () {
      const sessionID = SessionID.make(`ses_history_cost_${shape}`)
      const f = fixture(sessionID)
      for (let i = 0; i < 3000; i++) {
        const summary = shape !== "none" && (shape === "media-boundary" ? i === 2989 : i === 2900)
        const request = f.user(summary ? "manual summary parent" : "x".repeat(2048))
        if (summary && shape !== "manual") request.parts = [{
          id: PartID.make(`prt_${request.info.id}`), messageID: request.info.id, sessionID,
          type: "compaction", auto: true,
        }]
        const reply = f.assistant(request, { summary })
        reply.parts[0] = { ...reply.parts[0], type: "text", text: "y".repeat(2048) }
        reply.parts.push({
          id: PartID.make(`prt_${reply.info.id}_tool`), messageID: reply.info.id, sessionID,
          type: "tool", tool: "read", callID: `call_${i}`,
          state: {
            status: "completed", input: { file: "x" }, output: "z".repeat(8192), title: "t", metadata: {},
            time: { start: 0, end: 1 },
          },
        })
      }
      if (shape === "media-boundary") {
        // The boundary is at index 5978; its page also hydrates 28 older messages.
        // Put 20 x 2 MiB attachments on those discarded messages, never in model context.
        for (const message of f.messages.slice(5950, 5970)) message.parts.push({
          id: PartID.make(`prt_${message.info.id}_media`), messageID: message.info.id, sessionID,
          type: "file", mime: "image/png", filename: "large.png", url: "data:image/png;base64," + "A".repeat(2 * 1024 * 1024),
        })
      }
      yield* seed(sessionID, f.messages)
      expect(f.messages).toHaveLength(6000)
      const database = yield* Database.Service
      const old = Effect.gen(function* () {
        return project(sessionID)(yield* fullHistory(sessionID))
      })
      const next = Effect.gen(function* () {
        return project(sessionID)(yield* MessageV2.filterCompactedEffect(sessionID))
      })
      const reference = Buffer.from(JSON.stringify(yield* old))
      expect(Buffer.from(JSON.stringify(yield* next))).toEqual(reference)
      const counts: Record<string, { rows: number; bytes: number; partRows: number; partBytes: number }> = {}
      for (const [name, load] of [["old", old], ["new", next]] as const) {
        const observed = observedDatabase(database)
        const result = yield* load.pipe(Effect.provideService(Database.Service, observed.service))
        expect(Buffer.from(JSON.stringify(result))).toEqual(reference)
        counts[name] = observed.reads.reduce((total, read) => ({
          rows: total.rows + read.rows, bytes: total.bytes + read.bytes,
          partRows: total.partRows + (read.table === PartTable ? read.rows : 0),
          partBytes: total.partBytes + (read.table === PartTable ? read.bytes : 0),
        }), { rows: 0, bytes: 0, partRows: 0, partBytes: 0 })
      }
      const rounds: { round: number; slot: number; control: boolean; order: string; path: string; ms: number; maxWait: number; probes: number }[] = []
      // Three old/old rounds measure the run's own scheduling noise without a product change.
      for (let round = 0; round < 9; round++) {
        const order = round >= 6 ? ["old", "old"] : round % 2 === 0 ? ["old", "new"] : ["new", "old"]
        for (let slot = 0; slot < order.length; slot++) {
          const name = order[slot]
          const state = { running: true }
          const waits: number[] = []
          const prober = yield* Effect.gen(function* () {
            while (state.running) {
              const start = performance.now()
              yield* database.db.select({ id: SessionTable.id }).from(SessionTable)
                .where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
              waits.push(performance.now() - start)
              yield* Effect.yieldNow
            }
          }).pipe(Effect.forkChild({ startImmediately: true }))
          yield* Effect.yieldNow
          const start = performance.now()
          const out = yield* (name === "old" ? old : next)
          const ms = performance.now() - start
          state.running = false
          yield* Fiber.join(prober)
          expect(Buffer.from(JSON.stringify(out))).toEqual(reference)
          rounds.push({ round, slot, control: round >= 6, order: order.join("/"), path: name, ms, maxWait: Math.max(0, ...waits), probes: waits.length })
        }
      }
      console.log(JSON.stringify({ costShape: shape, messages: f.messages.length, counts, rounds }))
      if (shape === "none" || shape === "manual") expect(counts.new).toEqual(counts.old)
      if (shape === "auto") expect(counts.new.bytes).toBeLessThan(counts.old.bytes / 10)
      if (shape === "media-boundary") {
        expect(counts.new.partBytes).toBeGreaterThan(20 * 2 * 1024 * 1024)
        expect(counts.new.partBytes).toBeLessThan(counts.old.partBytes)
      }
      yield* database.db.delete(SessionTable).where(eq(SessionTable.id, sessionID))
    }), 50_000)
  }
})
