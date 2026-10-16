import { beforeEach, describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { MessageV2 } from "@/session/message-v2"
import { KiloSessionTitle } from "@/kilocode/session/title"

const sessionID = "ses_test" as MessageV2.WithParts["info"]["sessionID"]

function text(value: string, extra?: { synthetic?: boolean; ignored?: boolean }) {
  return {
    id: `prt_${Math.random().toString(36).slice(2)}`,
    sessionID,
    messageID: `msg_${Math.random().toString(36).slice(2)}`,
    type: "text",
    text: value,
    ...extra,
  } as MessageV2.Part
}

function tool(tool: string, title: string, output: string) {
  return {
    id: `prt_${Math.random().toString(36).slice(2)}`,
    sessionID,
    messageID: `msg_${Math.random().toString(36).slice(2)}`,
    type: "tool",
    callID: "call_1",
    tool,
    state: { status: "completed", input: {}, output, title, metadata: {}, time: { start: 0, end: 1 } },
  } as MessageV2.Part
}

let seq = 0
function user(parts: MessageV2.Part[]): MessageV2.WithParts {
  return {
    info: { id: `msg_u${seq++}`, sessionID, role: "user", time: { created: 0 }, agent: "build", model: {} },
    parts,
  } as unknown as MessageV2.WithParts
}

function assistant(parts: MessageV2.Part[]): MessageV2.WithParts {
  return { info: { id: `msg_a${seq++}`, sessionID, role: "assistant" }, parts } as unknown as MessageV2.WithParts
}

function content(messages: ModelMessage[]) {
  const first = messages[0] as { content?: unknown } | undefined
  return typeof first?.content === "string" ? first.content : JSON.stringify(first?.content)
}

beforeEach(() => KiloSessionTitle.clearAll())

describe("KiloSessionTitle.shouldGenerate", () => {
  test("waits for a short first message without tool work", () => {
    const history = [user([text("fix this bug")])]
    expect(KiloSessionTitle.shouldGenerate({ sessionID, history })).toBe(false)
  })

  test("names a substantial first message and consumes one attempt", () => {
    const history = [user([text("x".repeat(200))])]
    expect(KiloSessionTitle.shouldGenerate({ sessionID, history })).toBe(true)
    expect(KiloSessionTitle.shouldGenerate({ sessionID, history })).toBe(true)
  })

  test("names once a turn ran a tool", () => {
    const history = [user([text("see the link")]), assistant([tool("getBugDetails", "Bug 14212", "bug details")])]
    expect(KiloSessionTitle.shouldGenerate({ sessionID, history })).toBe(true)
  })

  test("names a second user message even without work", () => {
    const history = [user([text("hi")]), assistant([text("hello")]), user([text("fix the parser")])]
    expect(KiloSessionTitle.shouldGenerate({ sessionID, history })).toBe(true)
  })

  test("ignores synthetic-only user turns", () => {
    const history = [user([text("Summarize the task tool output above", { synthetic: true })])]
    expect(KiloSessionTitle.shouldGenerate({ sessionID, history })).toBe(false)
  })

  test("stops after the attempt cap", () => {
    const history = [user([text("x".repeat(200))])]
    for (let i = 0; i < 4; i++) expect(KiloSessionTitle.shouldGenerate({ sessionID, history })).toBe(true)
    expect(KiloSessionTitle.shouldGenerate({ sessionID, history })).toBe(false)
  })
})

describe("KiloSessionTitle.build", () => {
  test("returns null without a real user turn", () => {
    expect(KiloSessionTitle.build([])).toBeNull()
    expect(KiloSessionTitle.build([user([text("hidden", { synthetic: true })])])).toBeNull()
  })

  test("includes the title request marker and recent user messages", () => {
    const history = [user([text("first ask")]), assistant([text("ok")]), user([text("second ask")])]
    const built = KiloSessionTitle.build(history)
    expect(built).not.toBeNull()
    const body = content(built!.messages)
    expect(body).toContain("Generate a title for this conversation")
    expect(body).toContain("Title the task, not the reference")
    expect(body).toContain("first ask")
    expect(body).toContain("second ask")
  })

  test("adds bounded tool excerpts from the current turn", () => {
    const history = [user([text("fix the link")]), assistant([tool("getBugDetails", "Bug 14212", "y".repeat(900))])]
    const body = content(KiloSessionTitle.build(history)!.messages)
    expect(body).toContain("getBugDetails: Bug 14212")
    expect(body).toContain("y".repeat(500))
    expect(body).not.toContain("y".repeat(501))
  })

  test("drops synthetic user text from the context", () => {
    const history = [user([text("visible", {}), text("hidden", { synthetic: true })])]
    const body = content(KiloSessionTitle.build(history)!.messages)
    expect(body).toContain("visible")
    expect(body).not.toContain("hidden")
  })
})
