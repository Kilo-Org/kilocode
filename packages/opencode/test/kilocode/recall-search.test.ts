import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { RecallSearch } from "../../src/kilocode/session/recall-search"
import { Instance } from "../../src/kilocode/instance"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { seedProject } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

type Stored<T> = T extends unknown ? Omit<T, "id" | "sessionID" | "messageID"> : never

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Database.defaultLayer))

const add = Effect.fn("RecallSearchTest.add")(function* (
  sessionID: SessionID,
  role: "user" | "assistant",
  data: Stored<MessageV2.Part>,
  opts?: { parentID?: MessageID },
) {
  const messageID = MessageID.ascending()
  const message: Stored<MessageV2.Info> =
    role === "user"
      ? {
          role,
          time: { created: Date.now() },
          agent: "code",
          model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        }
      : {
          role,
          time: { created: Date.now(), completed: Date.now() },
          parentID: opts?.parentID ?? MessageID.ascending(),
          modelID: ModelV2.ID.make("test"),
          providerID: ProviderV2.ID.make("test"),
          mode: "code",
          agent: "code",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: "stop",
        }
  const partID = PartID.ascending()
  const { db } = yield* Database.Service
  yield* db
    .insert(MessageTable)
    .values({ id: messageID, session_id: sessionID, time_created: Date.now(), data: message })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(PartTable)
    .values({ id: partID, message_id: messageID, session_id: sessionID, time_created: Date.now(), data })
    .run()
    .pipe(Effect.orDie)
  return { messageID, partID }
})

function run(query: string, signal?: AbortSignal) {
  return RecallSearch.search({
    query,
    projectID: Instance.project.id,
    directories: [Instance.worktree],
    signal,
  })
}
it.instance(
  "searches titles and terms distributed across transcript messages",
  () =>
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "Quartz migration" })
      yield* add(session.id, "user", { type: "text", text: "Investigate the zephyr request path" })
      yield* add(session.id, "assistant", { type: "text", text: "The cobalt adapter needs a bounded scan" })

      expect((yield* run("quartz")).results.map((item) => item.id)).toEqual([session.id])
      const result = yield* run("zephyr cobalt")
      expect(result.results.map((item) => item.id)).toEqual([session.id])
      expect(result.results[0]?.matches.map((item) => item.source)).toEqual(["user", "assistant"])

      const title = yield* sessions.create({ title: "ranking-needle" })
      const user = yield* sessions.create({ title: "User rank" })
      const assistant = yield* sessions.create({ title: "Assistant rank" })
      yield* add(user.id, "user", { type: "text", text: "ranking-needle" })
      yield* add(assistant.id, "assistant", { type: "text", text: "ranking-needle" })
      expect((yield* run("ranking-needle")).results.map((item) => item.id)).toEqual([title.id, user.id, assistant.id])
    }),
  { git: true },
)

it.instance(
  "excludes the active user turn from recall results",
  () =>
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const historical = yield* sessions.create({ title: "Historical" })
      const active = yield* sessions.create({ title: "exclusive-recall-needle" })
      yield* add(historical.id, "user", { type: "text", text: "exclusive-recall-needle" })
      yield* add(active.id, "user", { type: "text", text: "older unrelated turn" })
      yield* add(active.id, "user", { type: "text", text: "exclusive-recall-needle" })
      yield* add(active.id, "assistant", { type: "text", text: "exclusive-recall-needle" })
      yield* add(active.id, "user", { type: "text", text: "exclusive-recall-needle", synthetic: true })
      const current = yield* add(active.id, "assistant", { type: "text", text: "exclusive-recall-needle" })
      const messages = yield* sessions.messages({ sessionID: active.id })

      const result = yield* RecallSearch.search({
        query: "exclusive-recall-needle",
        projectID: Instance.project.id,
        directories: [Instance.worktree],
        limit: 1,
        excludeSessionID: active.id,
        excludeFromMessageID: RecallSearch.active(messages, current.messageID),
      })
      expect(result.results.map((item) => item.id)).toEqual([historical.id])
    }),
  { git: true },
)

it.instance(
  "keeps prior assistant tail written after an active queued prompt",
  () =>
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "Queued turn" })
      const previous = yield* add(session.id, "user", { type: "text", text: "previous request" })
      const active = yield* add(session.id, "user", { type: "text", text: "queued prompt current-turn-needle" })
      const tail = yield* add(
        session.id,
        "assistant",
        { type: "text", text: "prior assistant tail tail-turn-needle" },
        { parentID: previous.messageID },
      )
      yield* add(
        session.id,
        "assistant",
        { type: "text", text: "current assistant current-turn-needle" },
        { parentID: active.messageID },
      )

      const messages = yield* sessions.messages({ sessionID: session.id })
      expect(RecallSearch.visible(messages, active.messageID).map((message) => message.info.id)).toEqual([
        previous.messageID,
        tail.messageID,
      ])

      const result = yield* RecallSearch.search({
        query: "tail-turn-needle",
        projectID: Instance.project.id,
        directories: [Instance.worktree],
        excludeSessionID: session.id,
        excludeFromMessageID: active.messageID,
      })
      expect(result.results.map((item) => item.id)).toEqual([session.id])

      const current = yield* RecallSearch.search({
        query: "current-turn-needle",
        projectID: Instance.project.id,
        directories: [Instance.worktree],
        excludeSessionID: session.id,
        excludeFromMessageID: active.messageID,
      })
      expect(current.results).toEqual([])
    }),
  { git: true },
)

it.instance(
  "searches references and errors while excluding noisy content",
  () =>
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "Search policy" })
      yield* add(session.id, "user", {
        type: "file",
        mime: "text/plain",
        filename: "recall-search.ts",
        url: "file:///tmp/recall-search.ts",
        source: {
          type: "symbol",
          path: "packages/opencode/src/kilocode/session/recall-search.ts",
          name: "RecallSearch",
          kind: 12,
          range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
          text: { value: "RecallSearch", start: 0, end: 12 },
        },
      })
      yield* add(session.id, "assistant", {
        type: "tool",
        callID: "error",
        tool: "bash",
        state: { status: "error", input: {}, error: "EADDRINUSE on port 4321", time: { start: 1, end: 2 } },
      })
      yield* add(session.id, "assistant", {
        type: "tool",
        callID: "success",
        tool: "read",
        state: {
          status: "completed",
          input: {},
          output: "hidden-success-output",
          title: "hidden title",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      })
      yield* add(session.id, "user", {
        type: "file",
        mime: "text/plain",
        url: "file:///tmp/url-only-cedar.ts",
      })
      yield* add(session.id, "user", {
        type: "file",
        mime: "text/plain",
        url: "data:text/plain;base64,aGlkZGVuLWRhdGEtdXJs",
        source: {
          type: "resource",
          clientName: "test",
          uri: "data:text/plain;base64,aGlkZGVuLXJlc291cmNlLXVyaQ==",
          text: { value: "hidden", start: 0, end: 6 },
        },
      })
      yield* add(session.id, "assistant", {
        type: "reasoning",
        text: "hidden-reasoning",
        time: { start: 1, end: 2 },
      })
      yield* add(session.id, "user", { type: "text", text: "hidden-synthetic", synthetic: true })

      expect((yield* run("RecallSearch")).results[0]?.matches[0]?.source).toBe("reference")
      expect((yield* run("EADDRINUSE")).results[0]?.matches[0]?.source).toBe("error")
      expect((yield* run("url-only-cedar")).results[0]?.matches[0]?.source).toBe("reference")
      expect((yield* run("aGlkZGVuLWRhdGEtdXJs")).results).toEqual([])
      expect((yield* run("aGlkZGVuLXJlc291cmNlLXVyaQ")).results).toEqual([])
      expect((yield* run("hidden-success-output")).results).toEqual([])
      expect((yield* run("hidden-reasoning")).results).toEqual([])
      expect((yield* run("hidden-synthetic")).results).toEqual([])
    }),
  { git: true },
)

it.instance(
  "searches every batch while respecting worktree scope",
  () =>
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({ title: "Parent" })
      const child = yield* sessions.create({ title: "Child", parentID: parent.id })
      yield* sessions.setArchived({ sessionID: child.id, time: Date.now() })
      yield* add(child.id, "user", { type: "text", text: "archived-child-needle" })

      const broad = yield* sessions.create({ title: "Broad" })
      for (let index = 0; index < 300; index++) {
        yield* add(broad.id, "user", { type: "text", text: `page ${index}` })
      }
      for (let index = 0; index < 140; index++) {
        const session = yield* sessions.create({ title: `Batch ${index}` })
        if (index === 139) yield* add(session.id, "user", { type: "text", text: "last-session-needle" })
      }

      const outside = yield* sessions.create({ title: "Outside" })
      yield* add(outside.id, "user", { type: "text", text: "last-session-needle" })
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ directory: `${Instance.worktree}-other` })
        .where(eq(SessionTable.id, outside.id))
        .run()
        .pipe(Effect.orDie)

      expect((yield* run("archived-child-needle")).results.map((item) => item.id)).toEqual([child.id])
      const result = yield* run("last-session-needle")
      expect(result.results).toHaveLength(1)
      expect(result.sessions).toBe(143)
      expect(result.parts).toBe(302)
    }),
  { git: true },
)

it.instance(
  "supports literal matching, bounded snippets, and cancellation",
  () =>
    Effect.gen(function* () {
      yield* seedProject
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "Large session" })
      yield* add(session.id, "user", { type: "text", text: "job_id reached 100%" })
      yield* add(session.id, "user", { type: "text", text: `${"x".repeat(1_000)} Compatibility ＦＯＯ marker` })
      yield* add(session.id, "user", {
        type: "text",
        text: `terminal ${"x".repeat(20_000)} terminal needle ${"y".repeat(20_000)}`,
      })
      for (let index = 0; index < 300; index++) {
        yield* add(session.id, "user", { type: "text", text: `noise ${index}` })
      }

      expect((yield* run("job_id 100%")).results.map((item) => item.id)).toEqual([session.id])
      const compatibility = yield* run("foo")
      expect(compatibility.results.map((item) => item.id)).toEqual([session.id])
      expect(compatibility.results[0]?.matches[0]?.text).toContain("ＦＯＯ")
      const snippet = (yield* run("terminal needle")).results[0]?.matches[0]?.text ?? ""
      expect(snippet).toContain("terminal needle")
      expect(snippet.length).toBeLessThan(370)

      const database = yield* Database.Service
      const controller = new AbortController()
      const pending = Effect.runPromise(
        run("absent-needle", controller.signal).pipe(Effect.provideService(Database.Service, database)),
      )
      queueMicrotask(() => controller.abort(new Error("cancelled recall search")))
      const error = yield* Effect.promise(() => pending.catch((value: unknown) => value))
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) return yield* Effect.die(new Error("Expected recall search to fail"))
      expect(error.message).toBe("cancelled recall search")
    }),
  { git: true },
)
