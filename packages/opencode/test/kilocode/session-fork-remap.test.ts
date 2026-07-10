import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import { provideTestInstance } from "../fixture/fixture"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { eq } from "drizzle-orm"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { Flag } from "@opencode-ai/core/flag/flag"
import { KiloPartLifecycle } from "../../src/kilocode/session/part-lifecycle"
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InstanceRef } from "../../src/effect/instance-ref"
import path from "path"
import os from "os"
import fs from "fs/promises"

Log.init({ print: false })

const previous = Flag.KILO_DB
const dbfile = path.join(os.tmpdir(), `kilo-fork-${process.pid}-${crypto.randomUUID()}.db`)

beforeAll(async () => {
  await fs.rm(dbfile, { force: true })
  Flag.KILO_DB = dbfile
})

afterAll(async () => {
  Flag.KILO_DB = previous
  await Promise.all([dbfile, `${dbfile}-wal`, `${dbfile}-shm`].map((file) => fs.rm(file, { force: true })))
})

const sessions = {
  create: (input?: Parameters<Session.Interface["create"]>[0]) =>
    Effect.runPromise(Session.Service.use((svc) => svc.create(input)).pipe(Effect.provide(Session.defaultLayer))),
  list: () => Effect.runPromise(Session.Service.use((svc) => svc.list()).pipe(Effect.provide(Session.defaultLayer))),
  messages: (input: Parameters<Session.Interface["messages"]>[0]) =>
    Effect.runPromise(Session.Service.use((svc) => svc.messages(input)).pipe(Effect.provide(Session.defaultLayer))),
  updateMessage: <T extends MessageV2.Info>(msg: T) =>
    Effect.runPromise(Session.Service.use((svc) => svc.updateMessage(msg)).pipe(Effect.provide(Session.defaultLayer))),
  updatePart: <T extends MessageV2.Part>(part: T) =>
    Effect.runPromise(Session.Service.use((svc) => svc.updatePart(part)).pipe(Effect.provide(Session.defaultLayer))),
}

afterEach(async () => {
  await disposeAllInstances()
})

async function instance<R>(input: { directory: string; fn: () => R }) {
  return provideTestInstance({
    ...input,
    init: Effect.gen(function* () {
      const ctx = yield* InstanceRef
      if (!ctx) return yield* Effect.die(new Error("missing test instance"))
      const { db } = yield* CoreDatabase.Service
      yield* db
        .insert(ProjectTable)
        .values({
          id: ProjectV2.ID.make(ctx.project.id),
          worktree: AbsolutePath.make(ctx.worktree),
          sandboxes: [],
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
    }).pipe(Effect.provide(CoreDatabase.defaultLayer)),
  })
}

function taskPart(input: { messageID: string; sessionID: string; childSessionID: string }): MessageV2.ToolPart {
  return {
    id: PartID.ascending(),
    messageID: MessageID.make(input.messageID),
    sessionID: SessionID.make(input.sessionID),
    type: "tool",
    callID: "call_1",
    tool: "task",
    metadata: { sessionId: input.childSessionID, trace: "keep" },
    state: {
      status: "completed",
      input: { description: "test task", prompt: "do something", task_id: input.childSessionID },
      output: [
        "Background task completed: test task",
        `\ttask_id: ${input.childSessionID} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        "child outcome",
        "</task_result>",
      ].join("\r\n"),
      title: "test task",
      metadata: {
        sessionId: input.childSessionID,
        model: { modelID: "test", providerID: "test" },
      },
      time: { start: Date.now(), end: Date.now() },
    },
  }
}

async function userMsg(sid: string) {
  const id = MessageID.ascending()
  await sessions.updateMessage({
    id,
    sessionID: SessionID.make(sid),
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: "test", modelID: "test" },
    tools: {},
  } as MessageV2.User)
  return id
}

async function asstMsg(sid: string, parent: string, cost = 0) {
  const id = MessageID.ascending()
  await sessions.updateMessage({
    id,
    sessionID: SessionID.make(sid),
    role: "assistant",
    time: { created: Date.now() },
    parentID: MessageID.make(parent),
    modelID: "test",
    providerID: "test",
    mode: "",
    agent: "test",
    path: { cwd: "/tmp", root: "/tmp" },
    cost,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as MessageV2.Assistant)
  return id
}

describe("Session.fork cost accounting", () => {
  test(
    "forked sessions start with zero cost",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await instance({
        directory: tmp.path,
        fn: async () => {
          const original = await sessions.create({ title: "original" })
          const user = await userMsg(original.id)
          const assistant = await asstMsg(original.id, user, 0.42)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistant,
            sessionID: original.id,
            type: "step-finish",
            reason: "stop",
            cost: 0.42,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          } as MessageV2.StepFinishPart)

          const forked = await Session.fork({ sessionID: original.id })
          const source = await sessions.messages({ sessionID: original.id })
          const copy = await sessions.messages({ sessionID: forked.id })
          const cost = (msgs: MessageV2.WithParts[]) =>
            msgs.reduce((sum, msg) => sum + (msg.info.role === "assistant" ? msg.info.cost : 0), 0)
          const steps = (msgs: MessageV2.WithParts[]) =>
            msgs
              .flatMap((msg) => msg.parts)
              .reduce((sum, part) => sum + (part.type === "step-finish" ? part.cost : 0), 0)

          expect(cost(source)).toBe(0.42)
          expect(cost(copy)).toBe(0)
          expect(steps(source)).toBe(0.42)
          expect(steps(copy)).toBe(0)
        },
      })
    },
    { timeout: 30000 },
  )
})

describe("Session.fork task detachment", () => {
  test(
    "keeps completed task outcomes without cloning child sessions",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await instance({
        directory: tmp.path,
        fn: async () => {
          const parent = await sessions.create({ title: "parent" })
          const child = await sessions.create({ parentID: parent.id, title: "child subagent" })
          const childMsg = await userMsg(child.id)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: childMsg,
            sessionID: child.id,
            type: "text",
            text: "child message content",
          } as MessageV2.TextPart)

          const user = await userMsg(parent.id)
          const assistant = await asstMsg(parent.id, user)
          await sessions.updatePart(taskPart({ messageID: assistant, sessionID: parent.id, childSessionID: child.id }))
          const before = await sessions.list()

          const client = createKiloClient({
            baseUrl: "http://localhost",
            directory: tmp.path,
            fetch: ((request: Request) => Server.Default().app.fetch(request)) as unknown as typeof fetch,
          })
          const { data: forked } = await client.session.fork(
            { sessionID: parent.id, directory: tmp.path },
            { throwOnError: true },
          )

          const after = await sessions.list()
          expect(after).toHaveLength(before.length + 1)

          const msgs = await sessions.messages({ sessionID: SessionID.make(forked.id) })
          const tool = msgs.flatMap((msg) => msg.parts).find((part) => part.type === "tool") as MessageV2.ToolPart
          expect(tool.state.status).toBe("completed")
          if (tool.state.status !== "completed") throw new Error("expected completed task")
          expect(tool.metadata).toEqual({ trace: "keep" })
          expect(tool.state.metadata).toEqual({ model: { modelID: "test", providerID: "test" } })
          expect(tool.state.input.task_id).toBeUndefined()
          expect(tool.state.output).toBe(
            "Background task completed: test task\r\n<task_result>\r\nchild outcome\r\n</task_result>",
          )

          const source = await sessions.messages({ sessionID: parent.id })
          const original = source.flatMap((msg) => msg.parts).find((part) => part.type === "tool") as MessageV2.ToolPart
          expect(original.state.status).toBe("completed")
          if (original.state.status !== "completed") throw new Error("expected completed source task")
          expect(original.state.metadata.sessionId).toBe(child.id)
          expect(original.state.input.task_id).toBe(child.id)
        },
      })
    },
    { timeout: 30000 },
  )

  test(
    "turns copied running tasks into terminal historical errors",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await instance({
        directory: tmp.path,
        fn: async () => {
          const parent = await sessions.create({ title: "parent" })
          const child = await sessions.create({ parentID: parent.id, title: "child" })
          const user = await userMsg(parent.id)
          const assistant = await asstMsg(parent.id, user)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistant,
            sessionID: parent.id,
            type: "tool",
            callID: "call_running",
            tool: "task",
            metadata: { sessionId: child.id },
            state: {
              status: "running",
              input: { description: "running", task_id: child.id },
              metadata: { sessionId: child.id, variant: "high" },
              time: { start: Date.now() },
            },
          } as MessageV2.ToolPart)

          const forked = await Session.fork({ sessionID: parent.id })
          const msgs = await sessions.messages({ sessionID: forked.id })
          const tool = msgs.flatMap((msg) => msg.parts).find((part) => part.type === "tool") as MessageV2.ToolPart
          expect(tool.state.status).toBe("error")
          if (tool.state.status !== "error") throw new Error("expected detached task error")
          expect(tool.state.error).toContain("still running")
          expect(tool.state.input.task_id).toBeUndefined()
          expect(tool.state.metadata).toEqual({ variant: "high" })
          expect(tool.metadata).toEqual({})
        },
      })
    },
    { timeout: 30000 },
  )

  test(
    "detaches pending and errored task references",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await instance({
        directory: tmp.path,
        fn: async () => {
          const parent = await sessions.create({ title: "parent" })
          const child = await sessions.create({ parentID: parent.id, title: "child" })
          const user = await userMsg(parent.id)
          const assistant = await asstMsg(parent.id, user)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistant,
            sessionID: parent.id,
            type: "tool",
            callID: "call_pending",
            tool: "task",
            metadata: { sessionID: child.id },
            state: {
              status: "pending",
              input: { task_id: child.id },
              raw: "pending",
            },
          } as MessageV2.ToolPart)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistant,
            sessionID: parent.id,
            type: "tool",
            callID: "call_error",
            tool: "task",
            metadata: { sessionId: child.id },
            state: {
              status: "error",
              input: { task_id: child.id },
              error: "original error",
              metadata: { sessionID: child.id, detail: "keep" },
              time: { start: Date.now(), end: Date.now() },
            },
          } as MessageV2.ToolPart)

          const forked = await Session.fork({ sessionID: parent.id })
          const msgs = await sessions.messages({ sessionID: forked.id })
          const tools = msgs.flatMap((msg) => msg.parts).filter((part) => part.type === "tool")
          const pending = tools.find((part) => part.callID === "call_pending")
          const errored = tools.find((part) => part.callID === "call_error")

          expect(pending?.state.status).toBe("error")
          if (!pending || pending.state.status !== "error") throw new Error("expected detached pending task")
          expect(pending.state.error).toContain("still pending")
          expect(pending.state.input.task_id).toBeUndefined()
          expect(pending.metadata).toEqual({})

          expect(errored?.state.status).toBe("error")
          if (!errored || errored.state.status !== "error") throw new Error("expected detached errored task")
          expect(errored.state.error).toBe("original error")
          expect(errored.state.input.task_id).toBeUndefined()
          expect(errored.state.metadata).toEqual({ detail: "keep" })
          expect(errored.metadata).toEqual({})
        },
      })
    },
    { timeout: 30000 },
  )

  test(
    "preserves workspace sync event sequencing in the atomic copy",
    async () => {
      const flag = Flag.KILO_EXPERIMENTAL_WORKSPACES
      Flag.KILO_EXPERIMENTAL_WORKSPACES = true
      try {
        await using tmp = await tmpdir({ git: true })
        await instance({
          directory: tmp.path,
          fn: async () => {
            const parent = await sessions.create({ title: "parent" })
            const user = await userMsg(parent.id)
            await sessions.updatePart({
              id: PartID.ascending(),
              messageID: user,
              sessionID: parent.id,
              type: "text",
              text: "hello",
            } as MessageV2.TextPart)

            const forked = await Session.fork({ sessionID: parent.id })
            const [rows, sequence] = await Effect.runPromise(
              Effect.gen(function* () {
                const { db } = yield* CoreDatabase.Service
                return yield* Effect.all([
                  db
                    .select({ seq: EventTable.seq, type: EventTable.type })
                    .from(EventTable)
                    .where(eq(EventTable.aggregate_id, forked.id))
                    .orderBy(EventTable.seq)
                    .all()
                    .pipe(Effect.orDie),
                  db
                    .select({ seq: EventSequenceTable.seq })
                    .from(EventSequenceTable)
                    .where(eq(EventSequenceTable.aggregate_id, forked.id))
                    .get()
                    .pipe(Effect.orDie),
                ])
              }).pipe(Effect.provide(CoreDatabase.defaultLayer)),
            )

            expect(rows).toEqual([
              { seq: 0, type: "session.created.1" },
              { seq: 1, type: "message.updated.1" },
              { seq: 2, type: "message.part.updated.1" },
            ])
            expect(sequence?.seq).toBe(2)
          },
        })
      } finally {
        Flag.KILO_EXPERIMENTAL_WORKSPACES = flag
      }
    },
    { timeout: 30000 },
  )

  test(
    "does not alter non-task parts",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await instance({
        directory: tmp.path,
        fn: async () => {
          const parent = await sessions.create({ title: "parent" })
          const user = await userMsg(parent.id)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: user,
            sessionID: parent.id,
            type: "text",
            text: "hello",
          } as MessageV2.TextPart)

          const forked = await Session.fork({ sessionID: parent.id })
          const msgs = await sessions.messages({ sessionID: forked.id })
          expect(msgs).toHaveLength(1)
          expect(msgs[0].parts[0]).toMatchObject({ type: "text", text: "hello" })
        },
      })
    },
    { timeout: 30000 },
  )

  test(
    "drops transient UI parts while preserving durable synthetic context",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await instance({
        directory: tmp.path,
        fn: async () => {
          const parent = await sessions.create({ title: "parent" })
          const user = await userMsg(parent.id)
          const parts = [
            { text: "Initializing snapshot... but durable", synthetic: true },
            { text: "<system-reminder>durable context</system-reminder>", synthetic: true },
            {
              text: "arbitrary live status",
              synthetic: true,
              metadata: { [KiloPartLifecycle.key]: "transient" },
            },
          ]
          for (const part of parts) {
            await sessions.updatePart({
              id: PartID.ascending(),
              messageID: user,
              sessionID: parent.id,
              type: "text",
              ...part,
            } as MessageV2.TextPart)
          }

          const forked = await Session.fork({ sessionID: parent.id })
          const source = await sessions.messages({ sessionID: parent.id })
          const copy = await sessions.messages({ sessionID: forked.id })
          const texts = copy.flatMap((msg) => msg.parts).flatMap((part) => (part.type === "text" ? [part.text] : []))

          expect(source.flatMap((msg) => msg.parts)).toHaveLength(3)
          expect(texts).toEqual([
            "Initializing snapshot... but durable",
            "<system-reminder>durable context</system-reminder>",
          ])
        },
      })
    },
    { timeout: 30000 },
  )
})
