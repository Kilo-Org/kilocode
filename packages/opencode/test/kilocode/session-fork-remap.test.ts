import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
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
  await Session.updateMessage({
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

async function asstMsg(sid: string, parent: string) {
  const id = MessageID.ascending()
  await Session.updateMessage({
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
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as MessageV2.Assistant)
  return id
}

describe("Session.fork child session remapping", () => {
  test(
    "forked session gets its own copy of child sessions",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ title: "parent" })
          const child = await Session.create({ parentID: parent.id, title: "child subagent" })

          // Add a user message to the child so it has content
          const childMsgId = await userMsg(child.id)
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: childMsgId,
            sessionID: child.id,
            type: "text",
            text: "child message content",
          } as MessageV2.TextPart)

          // Add a user message then an assistant message with a task tool part referencing the child
          const parentUserMsg = await userMsg(parent.id)
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: parentUserMsg,
            sessionID: parent.id,
            type: "text",
            text: "do something",
          } as MessageV2.TextPart)

          const parentAsstMsg = await asstMsg(parent.id, parentUserMsg)
          await Session.updatePart(
            taskPart({
              messageID: parentAsstMsg,
              sessionID: parent.id,
              childSessionID: child.id,
            }),
          )

          // Fork the parent session
          const forked = await Session.fork({ sessionID: parent.id })
          expect(forked.id).not.toBe(parent.id)

          // Check that the forked session's task part references a DIFFERENT child session
          const forkedMsgs = await Session.messages({ sessionID: forked.id })
          const parts = forkedMsgs.flatMap((m) => m.parts)
          const tools = parts.filter((p) => p.type === "tool" && p.tool === "task") as MessageV2.ToolPart[]

          expect(tools).toHaveLength(1)
          const meta = (tools[0].state as unknown as { metadata: { sessionId: string } }).metadata
          expect(meta.sessionId).not.toBe(child.id)

          // Verify the forked child session actually exists and has content
          const forkedChild = await Session.get(SessionID.make(meta.sessionId))
          expect(forkedChild).toBeDefined()
          expect(forkedChild.id).not.toBe(child.id)

          const forkedChildMsgs = await Session.messages({ sessionID: forkedChild.id })
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
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // grandchild -> child -> parent
          const parent = await Session.create({ title: "parent" })
          const child = await Session.create({ parentID: parent.id, title: "child" })
          const grandchild = await Session.create({ parentID: child.id, title: "grandchild" })

          // grandchild has a text message
          const gcMsgId = await userMsg(grandchild.id)
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: gcMsgId,
            sessionID: grandchild.id,
            type: "text",
            text: "grandchild content",
          } as MessageV2.TextPart)

          // child references grandchild via task part
          const childUserMsg = await userMsg(child.id)
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: childUserMsg,
            sessionID: child.id,
            type: "text",
            text: "question",
          } as MessageV2.TextPart)
          const childAsstMsg = await asstMsg(child.id, childUserMsg)
          await Session.updatePart(
            taskPart({
              messageID: childAsstMsg,
              sessionID: child.id,
              childSessionID: grandchild.id,
            }),
          )

          // parent references child via task part
          const parentUserMsg = await userMsg(parent.id)
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: parentUserMsg,
            sessionID: parent.id,
            type: "text",
            text: "request",
          } as MessageV2.TextPart)
          const parentAsstMsg = await asstMsg(parent.id, parentUserMsg)
          await Session.updatePart(
            taskPart({
              messageID: parentAsstMsg,
              sessionID: parent.id,
              childSessionID: child.id,
            }),
          )

          const forked = await Session.fork({ sessionID: parent.id })

          // Verify parent-level remap
          const forkedMsgs = await Session.messages({ sessionID: forked.id })
          const tools = forkedMsgs
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "tool" && p.tool === "task") as MessageV2.ToolPart[]
          const forkedChildID = (tools[0].state as unknown as { metadata: { sessionId: string } }).metadata.sessionId
          expect(forkedChildID).not.toBe(child.id)

          // Verify child-level remap (grandchild)
          const forkedChildMsgs = await Session.messages({ sessionID: SessionID.make(forkedChildID) })
          const childTools = forkedChildMsgs
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "tool" && p.tool === "task") as MessageV2.ToolPart[]
          expect(childTools).toHaveLength(1)
          const forkedGrandchildID = (childTools[0].state as unknown as { metadata: { sessionId: string } }).metadata
            .sessionId
          expect(forkedGrandchildID).not.toBe(grandchild.id)

          // Verify grandchild content was copied
          const gcMsgs = await Session.messages({ sessionID: SessionID.make(forkedGrandchildID) })
          expect(gcMsgs).toHaveLength(1)
        },
      })
    },
    { timeout: 30000 },
  )

  test(
    "non-task tool parts are not affected",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ title: "parent" })
          const parentUserMsg = await userMsg(parent.id)
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: parentUserMsg,
            sessionID: parent.id,
            type: "text",
            text: "hello",
          } as MessageV2.TextPart)

          const forked = await Session.fork({ sessionID: parent.id })
          const forkedMsgs = await Session.messages({ sessionID: forked.id })
          expect(forkedMsgs).toHaveLength(1)
          expect(forkedMsgs[0].parts[0].type).toBe("text")
          expect((forkedMsgs[0].parts[0] as MessageV2.TextPart).text).toBe("hello")
        },
      })
    },
    { timeout: 30000 },
  )
})
