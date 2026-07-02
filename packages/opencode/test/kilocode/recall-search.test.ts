import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { RecallSearch } from "../../src/kilocode/session/recall-search"
import { Instance } from "../../src/kilocode/instance"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageTable, PartTable, SessionTable } from "../../src/session/session.sql"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { Database, eq } from "../../src/storage/db"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

type Stored<T> = T extends unknown ? Omit<T, "id" | "sessionID" | "messageID"> : never

afterEach(resetDatabase)

function add(
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
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
        }
      : {
          role,
          time: { created: Date.now(), completed: Date.now() },
          parentID: opts?.parentID ?? MessageID.ascending(),
          modelID: ModelID.make("test"),
          providerID: ProviderID.make("test"),
          mode: "code",
          agent: "code",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: "stop",
        }
  const partID = PartID.ascending()
  Database.use((db) => {
    db.insert(MessageTable)
      .values({ id: messageID, session_id: sessionID, time_created: Date.now(), data: message })
      .run()
    db.insert(PartTable)
      .values({ id: partID, message_id: messageID, session_id: sessionID, time_created: Date.now(), data })
      .run()
  })
  return { messageID, partID }
}

function run(query: string, signal?: AbortSignal) {
  return RecallSearch.search({
    query,
    projectID: Instance.project.id,
    directories: [Instance.worktree],
    signal,
  })
}

describe("RecallSearch", () => {
  test("searches titles and terms distributed across transcript messages", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const service = await Effect.runPromise(Session.Service.pipe(Effect.provide(Session.defaultLayer)))
        const session = await Effect.runPromise(service.create({ title: "Quartz migration" }))
        add(session.id, "user", { type: "text", text: "Investigate the zephyr request path" })
        add(session.id, "assistant", { type: "text", text: "The cobalt adapter needs a bounded scan" })

        expect((await run("quartz")).results.map((item) => item.id)).toEqual([session.id])
        const result = await run("zephyr cobalt")
        expect(result.results.map((item) => item.id)).toEqual([session.id])
        expect(result.results[0]?.matches.map((item) => item.source)).toEqual(["user", "assistant"])

        const title = await Effect.runPromise(service.create({ title: "ranking-needle" }))
        const user = await Effect.runPromise(service.create({ title: "User rank" }))
        const assistant = await Effect.runPromise(service.create({ title: "Assistant rank" }))
        add(user.id, "user", { type: "text", text: "ranking-needle" })
        add(assistant.id, "assistant", { type: "text", text: "ranking-needle" })
        expect((await run("ranking-needle")).results.map((item) => item.id)).toEqual([title.id, user.id, assistant.id])
      },
    })
  })

  test("excludes the active user turn from recall results", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const service = await Effect.runPromise(Session.Service.pipe(Effect.provide(Session.defaultLayer)))
        const historical = await Effect.runPromise(service.create({ title: "Historical" }))
        const active = await Effect.runPromise(service.create({ title: "exclusive-recall-needle" }))
        add(historical.id, "user", { type: "text", text: "exclusive-recall-needle" })
        add(active.id, "user", { type: "text", text: "older unrelated turn" })
        add(active.id, "user", { type: "text", text: "exclusive-recall-needle" })
        add(active.id, "assistant", { type: "text", text: "exclusive-recall-needle" })
        add(active.id, "user", { type: "text", text: "exclusive-recall-needle", synthetic: true })
        const current = add(active.id, "assistant", { type: "text", text: "exclusive-recall-needle" })
        const messages = await Effect.runPromise(service.messages({ sessionID: active.id }))

        const result = await RecallSearch.search({
          query: "exclusive-recall-needle",
          projectID: Instance.project.id,
          directories: [Instance.worktree],
          limit: 1,
          excludeSessionID: active.id,
          excludeFromMessageID: RecallSearch.active(messages, current.messageID),
        })
        expect(result.results.map((item) => item.id)).toEqual([historical.id])
      },
    })
  })

  test("keeps prior assistant tail written after an active queued prompt", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const service = await Effect.runPromise(Session.Service.pipe(Effect.provide(Session.defaultLayer)))
        const session = await Effect.runPromise(service.create({ title: "Queued turn" }))
        const previous = add(session.id, "user", { type: "text", text: "previous request" })
        const active = add(session.id, "user", { type: "text", text: "queued prompt current-turn-needle" })
        const tail = add(
          session.id,
          "assistant",
          { type: "text", text: "prior assistant tail tail-turn-needle" },
          { parentID: previous.messageID },
        )
        add(
          session.id,
          "assistant",
          { type: "text", text: "current assistant current-turn-needle" },
          { parentID: active.messageID },
        )

        const messages = await Effect.runPromise(service.messages({ sessionID: session.id }))
        expect(RecallSearch.visible(messages, active.messageID).map((message) => message.info.id)).toEqual([
          previous.messageID,
          tail.messageID,
        ])

        const result = await RecallSearch.search({
          query: "tail-turn-needle",
          projectID: Instance.project.id,
          directories: [Instance.worktree],
          excludeSessionID: session.id,
          excludeFromMessageID: active.messageID,
        })
        expect(result.results.map((item) => item.id)).toEqual([session.id])

        const current = await RecallSearch.search({
          query: "current-turn-needle",
          projectID: Instance.project.id,
          directories: [Instance.worktree],
          excludeSessionID: session.id,
          excludeFromMessageID: active.messageID,
        })
        expect(current.results).toEqual([])
      },
    })
  })

  test("searches references and errors while excluding noisy content", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const service = await Effect.runPromise(Session.Service.pipe(Effect.provide(Session.defaultLayer)))
        const session = await Effect.runPromise(service.create({ title: "Search policy" }))
        add(session.id, "user", {
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
        add(session.id, "assistant", {
          type: "tool",
          callID: "error",
          tool: "bash",
          state: { status: "error", input: {}, error: "EADDRINUSE on port 4321", time: { start: 1, end: 2 } },
        })
        add(session.id, "assistant", {
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
        add(session.id, "user", {
          type: "file",
          mime: "text/plain",
          url: "file:///tmp/url-only-cedar.ts",
        })
        add(session.id, "user", {
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
        add(session.id, "assistant", { type: "reasoning", text: "hidden-reasoning", time: { start: 1, end: 2 } })
        add(session.id, "user", { type: "text", text: "hidden-synthetic", synthetic: true })

        expect((await run("RecallSearch")).results[0]?.matches[0]?.source).toBe("reference")
        expect((await run("EADDRINUSE")).results[0]?.matches[0]?.source).toBe("error")
        expect((await run("url-only-cedar")).results[0]?.matches[0]?.source).toBe("reference")
        expect((await run("aGlkZGVuLWRhdGEtdXJs")).results).toEqual([])
        expect((await run("aGlkZGVuLXJlc291cmNlLXVyaQ")).results).toEqual([])
        expect((await run("hidden-success-output")).results).toEqual([])
        expect((await run("hidden-reasoning")).results).toEqual([])
        expect((await run("hidden-synthetic")).results).toEqual([])
      },
    })
  })

  test("searches every page while respecting worktree scope", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const service = await Effect.runPromise(Session.Service.pipe(Effect.provide(Session.defaultLayer)))
        const parent = await Effect.runPromise(service.create({ title: "Parent" }))
        const child = await Effect.runPromise(service.create({ title: "Child", parentID: parent.id }))
        await Effect.runPromise(service.setArchived({ sessionID: child.id, time: Date.now() }))
        add(child.id, "user", { type: "text", text: "archived-child-needle" })

        const broad = await Effect.runPromise(service.create({ title: "Broad" }))
        for (let index = 0; index < 300; index++) add(broad.id, "user", { type: "text", text: `page ${index}` })
        for (let index = 0; index < 70; index++) {
          const session = await Effect.runPromise(service.create({ title: `Batch ${index}` }))
          if (index === 69) add(session.id, "user", { type: "text", text: "last-session-needle" })
        }

        const outside = await Effect.runPromise(service.create({ title: "Outside" }))
        add(outside.id, "user", { type: "text", text: "last-session-needle" })
        Database.use((db) =>
          db
            .update(SessionTable)
            .set({ directory: `${tmp.path}-other` })
            .where(eq(SessionTable.id, outside.id))
            .run(),
        )

        expect((await run("archived-child-needle")).results.map((item) => item.id)).toEqual([child.id])
        const result = await run("last-session-needle")
        expect(result.results).toHaveLength(1)
        expect(result.sessions).toBe(73)
        expect(result.parts).toBe(302)
      },
    })
  })

  test("supports literal matching, bounded snippets, and cancellation", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const service = await Effect.runPromise(Session.Service.pipe(Effect.provide(Session.defaultLayer)))
        const session = await Effect.runPromise(service.create({ title: "Large session" }))
        add(session.id, "user", { type: "text", text: "job_id reached 100%" })
        add(session.id, "user", { type: "text", text: `${"x".repeat(1_000)} Compatibility ＦＯＯ marker` })
        add(session.id, "user", {
          type: "text",
          text: `terminal ${"x".repeat(20_000)} terminal needle ${"y".repeat(20_000)}`,
        })
        for (let index = 0; index < 300; index++) add(session.id, "user", { type: "text", text: `noise ${index}` })

        expect((await run("job_id 100%")).results.map((item) => item.id)).toEqual([session.id])
        const compatibility = await run("foo")
        expect(compatibility.results.map((item) => item.id)).toEqual([session.id])
        expect(compatibility.results[0]?.matches[0]?.text).toContain("ＦＯＯ")
        const snippet = (await run("terminal needle")).results[0]?.matches[0]?.text ?? ""
        expect(snippet).toContain("terminal needle")
        expect(snippet.length).toBeLessThan(370)

        const controller = new AbortController()
        const pending = run("absent-needle", controller.signal)
        queueMicrotask(() => controller.abort(new Error("cancelled recall search")))
        const error = await pending.catch((value: unknown) => value)
        expect(error).toBeInstanceOf(Error)
        if (!(error instanceof Error)) throw new Error("Expected recall search to fail")
        expect(error.message).toBe("cancelled recall search")
      },
    })
  })
})
