import { describe, expect, it } from "bun:test"
import type { GlobalEvent, Part } from "@kilocode/sdk-v1/v2/client"
import { cursor } from "../../src/services/cli-backend/v2/client"
import { V2Events } from "../../src/services/cli-backend/v2/events"
import type { SessionMessageInfo, V2Event } from "@opencode/client"
import { messagesView, toolInput, toolName } from "../../src/services/cli-backend/v2/projection"

const sid = "ses_1"
const dir = "/repo"
const model = { id: "m", providerID: "p" }
const session = {
  id: sid,
  slug: sid,
  version: "v2",
  projectID: "prj",
  directory: dir,
  title: "",
  agent: "code",
  model,
  time: { created: 0, updated: 0 },
}

function fold() {
  return new V2Events({ directory: () => dir, session: async () => session })
}

let seq = 0
function ev(type: string, data: Record<string, unknown>): V2Event {
  seq += 1
  return {
    id: `evt_${String(seq).padStart(4, "0")}`,
    created: 1000 + seq,
    type,
    data: { sessionID: sid, ...data },
  } as V2Event
}

async function run(events: V2Event[]) {
  const target = fold()
  const out: GlobalEvent[] = []
  for (const event of events) out.push(...(await target.apply(event)))
  return out.map((item) => item.payload)
}

function flat(payloads: GlobalEvent["payload"][]) {
  return payloads.map((payload) => (payload.type === "sync" ? payload.syncEvent.type : payload.type))
}

function parts(payloads: GlobalEvent["payload"][]) {
  const map = new Map<string, Part>()
  for (const payload of payloads)
    if (payload.type === "sync" && payload.syncEvent.type === "message.part.updated.1") {
      const part = (payload.syncEvent.data as { part: Part }).part
      map.set(part.id, part)
    }
  return map
}

const turn = [
  ev("session.execution.started", {}),
  ev("session.step.started", { assistantMessageID: "msg_a", agent: "code", model, started: 1 }),
  ev("session.reasoning.started", { assistantMessageID: "msg_a", ordinal: 0 }),
  ev("session.reasoning.delta", { assistantMessageID: "msg_a", ordinal: 0, delta: "think" }),
  ev("session.reasoning.ended", { assistantMessageID: "msg_a", ordinal: 0, text: "think" }),
  ev("session.tool.input.started", { assistantMessageID: "msg_a", id: "call_1", name: "read" }),
  ev("session.tool.called", { assistantMessageID: "msg_a", id: "call_1", input: { path: "a.ts" }, executed: true }),
  ev("session.tool.success", {
    assistantMessageID: "msg_a",
    id: "call_1",
    content: [{ type: "text", text: "file body" }],
    executed: true,
  }),
  ev("session.text.started", { assistantMessageID: "msg_a", ordinal: 0 }),
  ev("session.text.delta", { assistantMessageID: "msg_a", ordinal: 0, delta: "Hel" }),
  ev("session.text.delta", { assistantMessageID: "msg_a", ordinal: 0, delta: "lo" }),
  ev("session.text.ended", { assistantMessageID: "msg_a", ordinal: 0, text: "Hello" }),
  ev("session.step.ended", {
    assistantMessageID: "msg_a",
    finish: "stop",
    cost: 0.5,
    tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 0, write: 0 } },
  }),
  ev("session.execution.succeeded", {}),
]

describe("v2 event fold", () => {
  it("folds one turn into v1 status, message, part, and delta events", async () => {
    const out = await run(turn)
    expect(flat(out)).toEqual([
      "session.turn.open",
      "session.status",
      "message.updated.1",
      "message.part.updated.1",
      "message.part.updated.1",
      "message.part.delta",
      "message.part.updated.1",
      "message.part.updated.1",
      "message.part.updated.1",
      "message.part.updated.1",
      "message.part.updated.1",
      "message.part.delta",
      "message.part.delta",
      "message.part.updated.1",
      "message.updated.1",
      "message.part.updated.1",
      "session.turn.close",
      "session.status",
    ])
    const status = out.filter((item) => item.type === "session.status").map((item) => item.properties.status.type)
    expect(status).toEqual(["busy", "idle"])
    const final = [...parts(out).values()]
    expect(final.map((part) => part.type)).toEqual(["step-start", "reasoning", "tool", "text", "step-finish"])
    const tool = final.find((part) => part.type === "tool")
    expect(tool?.type === "tool" && tool.state).toMatchObject({ status: "completed", output: "file body" })
    expect(final.find((part) => part.type === "text")).toMatchObject({ text: "Hello" })
  })

  it("uses the same part IDs as the stored message", async () => {
    const live = [...parts(await run(turn)).keys()].sort()
    const stored: SessionMessageInfo[] = [
      {
        id: "msg_a",
        type: "assistant",
        agent: "code",
        model,
        time: { created: 1, completed: 2 },
        finish: "stop",
        content: [
          { type: "reasoning", text: "think" },
          {
            type: "tool",
            id: "call_1",
            name: "read",
            state: { status: "completed", input: { path: "a.ts" }, content: [{ type: "text", text: "file body" }] },
            time: { created: 1 },
          },
          { type: "text", text: "Hello" },
        ],
      } as SessionMessageInfo,
    ]
    const history = messagesView({ sessionID: sid, directory: dir }, stored)
    expect(history.flatMap((item) => item.parts.map((part) => part.id))).toEqual(live)
  })

  it("closes open steps on a user interrupt but does not close the turn on shutdown", async () => {
    const start = ev("session.step.started", { assistantMessageID: "msg_b", agent: "code", model, started: 1 })
    const user = await run([start, ev("session.execution.interrupted", { reason: "user" })])
    expect(flat(user)).toEqual([
      "message.updated.1",
      "message.part.updated.1",
      "message.updated.1",
      "session.turn.close",
      "session.status",
    ])
    const aborted = user[2]
    expect(aborted.type === "sync" && aborted.syncEvent.data).toMatchObject({
      info: { error: { name: "MessageAbortedError" } },
    })
    const shutdown = await run([ev("session.execution.interrupted", { reason: "shutdown" })])
    expect(flat(shutdown)).toEqual(["session.status"])
  })
})

describe("v2 projection", () => {
  it("projects user and assistant records and skips switch records", () => {
    const list = [
      { id: "msg_s", type: "agent-switched", agent: "plan", time: { created: 0 } },
      { id: "msg_u", type: "user", text: "hi", time: { created: 1 } },
      { id: "msg_a", type: "assistant", agent: "plan", model, time: { created: 2 }, content: [] },
    ] as unknown as SessionMessageInfo[]
    const items = messagesView({ sessionID: sid, directory: dir, model }, list)
    expect(items.map((item) => item.info.role)).toEqual(["user", "assistant"])
    expect(items[0]?.info).toMatchObject({ agent: "plan", model: { providerID: "p", modelID: "m" } })
    expect(items[1]?.info).toMatchObject({ parentID: "msg_u", path: { cwd: dir } })
    expect(items[1]?.parts.map((part) => part.type)).toEqual(["step-start"])
  })

  it("translates the synthesized v1 message cursor and keeps v2 cursors", () => {
    const v1 = Buffer.from(JSON.stringify({ id: "msg_x", time: 5 })).toString("base64url")
    expect(JSON.parse(Buffer.from(cursor(v1), "base64url").toString())).toEqual({
      id: "msg_x",
      order: "desc",
      direction: "next",
    })
    const v2 = Buffer.from(JSON.stringify({ id: "msg_x", order: "desc", direction: "next" })).toString("base64url")
    expect(cursor(v2)).toBe(v2)
  })
})

describe("v2 tool names", () => {
  it("maps renamed v2 tools to the v1 names the tool renderers use", () => {
    expect(toolName("shell")).toBe("bash")
    expect(toolName("patch")).toBe("apply_patch")
    expect(toolName("subagent")).toBe("task")
    expect(toolName("read")).toBe("read")
    expect(toolName("server_tool")).toBe("server_tool")
  })

  it("adds the v1 input field names", () => {
    expect(toolInput("read", { path: "a.ts", offset: 1 })).toEqual({ path: "a.ts", filePath: "a.ts", offset: 1 })
    expect(toolInput("skill", { id: "review" })).toEqual({ id: "review", name: "review" })
    expect(toolInput("subagent", { agent: "explore", sessionID: "ses_2", prompt: "x" })).toMatchObject({
      subagent_type: "explore",
      task_id: "ses_2",
    })
    expect(toolInput("shell", { command: "ls" })).toEqual({ command: "ls" })
  })
})

