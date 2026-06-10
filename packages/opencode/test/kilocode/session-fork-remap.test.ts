import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import { WithInstance } from "../../src/project/with-instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const sessions = {
  create: (input?: Parameters<Session.Interface["create"]>[0]) =>
    Effect.runPromise(Session.Service.use((svc) => svc.create(input)).pipe(Effect.provide(Session.defaultLayer))),
  get: (id: SessionID) =>
    Effect.runPromise(Session.Service.use((svc) => svc.get(id)).pipe(Effect.provide(Session.defaultLayer))),
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

function taskPart(input: { messageID: string; sessionID: string; childSessionID: string }): MessageV2.ToolPart {
  return {
    id: PartID.ascending(),
    messageID: MessageID.make(input.messageID),
    sessionID: SessionID.make(input.sessionID),
    type: "tool",
    callID: "call_1",
    tool: "task",
    state: {
      status: "completed",
      input: { description: "test task", prompt: "do something" },
      output: `task_id: ${input.childSessionID}`,
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
      await WithInstance.provide({
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

describe("Session.fork child session remapping", () => {
  test(
    "forked session gets its own copy of child sessions",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await sessions.create({ title: "parent" })
          const child = await sessions.create({ parentID: parent.id, title: "child subagent" })

          // Add a user message to the child so it has content
          const childMsgId = await userMsg(child.id)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: childMsgId,
            sessionID: child.id,
            type: "text",
            text: "child message content",
          } as MessageV2.TextPart)

          // Add a user message then an assistant message with a task tool part referencing the child
          const parentUserMsg = await userMsg(parent.id)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: parentUserMsg,
            sessionID: parent.id,
            type: "text",
            text: "do something",
          } as MessageV2.TextPart)

          const parentAsstMsg = await asstMsg(parent.id, parentUserMsg)
          await sessions.updatePart(
            taskPart({
              messageID: parentAsstMsg,
              sessionID: parent.id,
              childSessionID: child.id,
            }),
          )

          // Exercise the SDK and HTTP route used by Agent Manager.
          const client = createKiloClient({
            baseUrl: "http://localhost",
            directory: tmp.path,
            fetch: ((request: Request) => Server.Default().app.fetch(request)) as unknown as typeof fetch,
          })
          const { data: forked } = await client.session.fork(
            { sessionID: parent.id, directory: tmp.path },
            { throwOnError: true },
          )
          expect(forked.id).not.toBe(parent.id)

          // Check that the forked session's task part references a DIFFERENT child session
          const forkedMsgs = await sessions.messages({ sessionID: SessionID.make(forked.id) })
          const parts = forkedMsgs.flatMap((m) => m.parts)
          const tools = parts.filter((p) => p.type === "tool" && p.tool === "task") as MessageV2.ToolPart[]

          expect(tools).toHaveLength(1)
          const meta = (tools[0].state as unknown as { metadata: { sessionId: string } }).metadata
          expect(meta.sessionId).not.toBe(child.id)

          // Verify the forked child session actually exists and has content
          const forkedChild = await sessions.get(SessionID.make(meta.sessionId))
          expect(forkedChild).toBeDefined()
          expect(forkedChild.id).not.toBe(child.id)

          const forkedChildMsgs = await sessions.messages({ sessionID: forkedChild.id })
          expect(forkedChildMsgs).toHaveLength(1)
          expect(forkedChildMsgs[0].parts[0].type).toBe("text")
        },
      })
    },
    { timeout: 30000 },
  )

  test(
    "nested child sessions are also remapped",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          // grandchild -> child -> parent
          const parent = await sessions.create({ title: "parent" })
          const child = await sessions.create({ parentID: parent.id, title: "child" })
          const grandchild = await sessions.create({ parentID: child.id, title: "grandchild" })

          // grandchild has a text message
          const gcMsgId = await userMsg(grandchild.id)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: gcMsgId,
            sessionID: grandchild.id,
            type: "text",
            text: "grandchild content",
          } as MessageV2.TextPart)

          // child references grandchild via task part
          const childUserMsg = await userMsg(child.id)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: childUserMsg,
            sessionID: child.id,
            type: "text",
            text: "question",
          } as MessageV2.TextPart)
          const childAsstMsg = await asstMsg(child.id, childUserMsg)
          await sessions.updatePart(
            taskPart({
              messageID: childAsstMsg,
              sessionID: child.id,
              childSessionID: grandchild.id,
            }),
          )

          // parent references child via task part
          const parentUserMsg = await userMsg(parent.id)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: parentUserMsg,
            sessionID: parent.id,
            type: "text",
            text: "request",
          } as MessageV2.TextPart)
          const parentAsstMsg = await asstMsg(parent.id, parentUserMsg)
          await sessions.updatePart(
            taskPart({
              messageID: parentAsstMsg,
              sessionID: parent.id,
              childSessionID: child.id,
            }),
          )

          const forked = await Session.fork({ sessionID: parent.id })

          // Verify parent-level remap
          const forkedMsgs = await sessions.messages({ sessionID: forked.id })
          const tools = forkedMsgs
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "tool" && p.tool === "task") as MessageV2.ToolPart[]
          const forkedChildID = (tools[0].state as unknown as { metadata: { sessionId: string } }).metadata.sessionId
          expect(forkedChildID).not.toBe(child.id)

          // Verify child-level remap (grandchild)
          const forkedChildMsgs = await sessions.messages({ sessionID: SessionID.make(forkedChildID) })
          const childTools = forkedChildMsgs
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "tool" && p.tool === "task") as MessageV2.ToolPart[]
          expect(childTools).toHaveLength(1)
          const forkedGrandchildID = (childTools[0].state as unknown as { metadata: { sessionId: string } }).metadata
            .sessionId
          expect(forkedGrandchildID).not.toBe(grandchild.id)

          // Verify grandchild content was copied
          const gcMsgs = await sessions.messages({ sessionID: SessionID.make(forkedGrandchildID) })
          expect(gcMsgs).toHaveLength(1)
        },
      })
    },
    { timeout: 30000 },
  )

  test(
    "self-referential task metadata remaps to the forked session",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await sessions.create({ title: "parent" })
          const msg = await userMsg(parent.id)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: msg,
            sessionID: parent.id,
            type: "text",
            text: "self task",
          } as MessageV2.TextPart)
          const asst = await asstMsg(parent.id, msg)
          await sessions.updatePart(
            taskPart({
              messageID: asst,
              sessionID: parent.id,
              childSessionID: parent.id,
            }),
          )

          const forked = await Session.fork({ sessionID: parent.id })
          const msgs = await sessions.messages({ sessionID: forked.id })
          const tools = msgs
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "tool" && p.tool === "task") as MessageV2.ToolPart[]

          expect(tools).toHaveLength(1)
          const meta = (tools[0].state as unknown as { metadata: { sessionId: string } }).metadata
          expect(meta.sessionId).toBe(forked.id)
        },
      })
    },
    { timeout: 30000 },
  )

  test(
    "cyclic task metadata remaps each session once",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await sessions.create({ title: "parent" })
          const child = await sessions.create({ parentID: parent.id, title: "child" })

          const parentMsg = await userMsg(parent.id)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: parentMsg,
            sessionID: parent.id,
            type: "text",
            text: "call child",
          } as MessageV2.TextPart)
          const parentAsst = await asstMsg(parent.id, parentMsg)
          await sessions.updatePart(
            taskPart({
              messageID: parentAsst,
              sessionID: parent.id,
              childSessionID: child.id,
            }),
          )

          const childMsg = await userMsg(child.id)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: childMsg,
            sessionID: child.id,
            type: "text",
            text: "call parent",
          } as MessageV2.TextPart)
          const childAsst = await asstMsg(child.id, childMsg)
          await sessions.updatePart(
            taskPart({
              messageID: childAsst,
              sessionID: child.id,
              childSessionID: parent.id,
            }),
          )

          const forked = await Session.fork({ sessionID: parent.id })
          const msgs = await sessions.messages({ sessionID: forked.id })
          const tools = msgs
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "tool" && p.tool === "task") as MessageV2.ToolPart[]
          const id = (tools[0].state as unknown as { metadata: { sessionId: SessionID } }).metadata.sessionId

          expect(id).not.toBe(child.id)
          const copy = await sessions.get(SessionID.make(id))
          expect(copy.id).toBe(id)

          const childMsgs = await sessions.messages({ sessionID: copy.id })
          const childTools = childMsgs
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "tool" && p.tool === "task") as MessageV2.ToolPart[]
          const back = (childTools[0].state as unknown as { metadata: { sessionId: string } }).metadata.sessionId

          expect(back).toBe(forked.id)
        },
      })
    },
    { timeout: 30000 },
  )

  test(
    "non-task tool parts are not affected",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await sessions.create({ title: "parent" })
          const parentUserMsg = await userMsg(parent.id)
          await sessions.updatePart({
            id: PartID.ascending(),
            messageID: parentUserMsg,
            sessionID: parent.id,
            type: "text",
            text: "hello",
          } as MessageV2.TextPart)

          const forked = await Session.fork({ sessionID: parent.id })
          const forkedMsgs = await sessions.messages({ sessionID: forked.id })
          expect(forkedMsgs).toHaveLength(1)
          expect(forkedMsgs[0].parts[0].type).toBe("text")
          expect((forkedMsgs[0].parts[0] as MessageV2.TextPart).text).toBe("hello")
        },
      })
    },
    { timeout: 30000 },
  )
})
