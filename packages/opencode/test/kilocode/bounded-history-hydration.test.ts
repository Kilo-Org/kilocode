import { describe, expect } from "bun:test"
import { Effect } from "effect"
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

const it = testEffect(LayerNode.compile(MessageV2.node))
const model = {
  id: ModelV2.ID.make("test"),
  providerID: ProviderV2.ID.make("test"),
  api: { id: "test", url: "https://example.invalid", npm: "@ai-sdk/anthropic" },
} as Provider.Model

function fixture(sessionID: SessionID) {
  const messages: MessageV2.WithParts[] = []
  function user(text = "hello", time = messages.length) {
    const id = MessageID.make(`msg_${String(100000 - messages.length).padStart(6, "0")}`)
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
    const id = MessageID.make(`msg_${String(100000 - messages.length).padStart(6, "0")}`)
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
    const full = project(sessionID)(MessageV2.filterCompacted(yield* MessageV2.stream(sessionID)))
    const bounded = yield* MessageV2.filterCompactedEffect(sessionID, project(sessionID))
    expect(Buffer.from(JSON.stringify(bounded))).toEqual(Buffer.from(JSON.stringify(full)))
    expect(KiloSessionMessageOrder.latest(bounded)).toEqual(KiloSessionMessageOrder.latest(full))
    const old = yield* MessageV2.toModelMessagesEffect(KiloSessionPrompt.maybeStripHistoricalMedia(full), model)
    const next = yield* MessageV2.toModelMessagesEffect(KiloSessionPrompt.maybeStripHistoricalMedia(bounded), model)
    expect(Buffer.from(JSON.stringify(next))).toEqual(Buffer.from(JSON.stringify(old)))
    return { full, bounded, bytes: Buffer.byteLength(JSON.stringify(next)) }
  })
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
        yield* KiloSessionPromptQueue.enqueue(sessionID, user.info.id, compare(sessionID), Effect.die("unexpected cancellation"))
        yield* (yield* Database.Service).db.delete(SessionTable).where(eq(SessionTable.id, sessionID))
        return
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
    const bounded = yield* MessageV2.filterCompactedEffect(sessionID, project(sessionID)).pipe(Effect.provideService(Database.Service, measured))
    const next = { ...counts, ms: performance.now() - begin }
    expect(Buffer.from(JSON.stringify(bounded))).toEqual(Buffer.from(JSON.stringify(project(sessionID)(MessageV2.filterCompacted(full)))))
    expect(next.bytes).toBeLessThan(old.bytes / 10)
    console.log(JSON.stringify({ measurement: "driver-returned rows and UTF-8 JSON bytes; not physical disk I/O", messages: f.messages.length, old, next }))
  }))
})
