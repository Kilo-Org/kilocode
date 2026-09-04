import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { KiloTrailingAssistant } from "../../../src/kilocode/session/trailing-assistant"

const text = (value: string) => ({ type: "text", text: value })
const toolCall = (id: string) => ({ type: "tool-call", toolCallId: id, toolName: "bash", input: {} })
const reasoning = (value: string) => ({ type: "reasoning", text: value })

const user = { role: "user", content: [text("hi")] }
const toolResult = {
  role: "tool",
  content: [{ type: "tool-result", toolCallId: "1", toolName: "bash", output: "" }],
}

/** Render each message as its ordered block types, so assertions read as wire shape. */
function shapes(messages: ModelMessage[]): string {
  return messages
    .map((message) => {
      const content: unknown = (message as { content?: unknown }).content
      if (!Array.isArray(content)) return `str:${String(content)}`
      return content.map((part: { type: string }) => part.type).join(",")
    })
    .join(" | ")
}

function sanitize(messages: unknown[]): string {
  return shapes(KiloTrailingAssistant.sanitize(messages as ModelMessage[]))
}

describe("KiloTrailingAssistant.sanitize - assistant block ordering", () => {
  test("leaves a well-formed [text, tool-call] message untouched", () => {
    expect(sanitize([user, { role: "assistant", content: [text("a"), toolCall("1")] }, toolResult])).toBe(
      "text | text,tool-call | tool-result",
    )
  })

  test("repairs an inverted [tool-call, text] message", () => {
    expect(sanitize([user, { role: "assistant", content: [toolCall("1"), text("a")] }, toolResult])).toBe(
      "text | text,tool-call | tool-result",
    )
  })

  test("keeps a leading reasoning block leading so signed thinking stays first", () => {
    expect(
      sanitize([user, { role: "assistant", content: [reasoning("r"), toolCall("1"), text("a")] }, toolResult]),
    ).toBe("text | reasoning,text,tool-call | tool-result")
  })

  test("drops empty text after a tool-call rather than moving it", () => {
    expect(sanitize([user, { role: "assistant", content: [toolCall("1"), text("   ")] }, toolResult])).toBe(
      "text | tool-call | tool-result",
    )
  })

  test("moves trailing text in front while preserving relative order", () => {
    expect(sanitize([user, { role: "assistant", content: [text("a"), toolCall("1"), text("b")] }, toolResult])).toBe(
      "text | text,text,tool-call | tool-result",
    )
  })

  test("moves text ahead of the first tool-call when several tool-calls exist", () => {
    expect(
      sanitize([user, { role: "assistant", content: [toolCall("1"), text("a"), toolCall("2")] }, toolResult]),
    ).toBe("text | text,tool-call,tool-call | tool-result")
  })

  test("leaves a message with no tool-call untouched", () => {
    expect(sanitize([user, { role: "assistant", content: [text("a"), reasoning("r")] }, toolResult])).toBe(
      "text | text,reasoning | tool-result",
    )
  })

  test("preserves the moved text verbatim", () => {
    const result = KiloTrailingAssistant.sanitize([
      user,
      { role: "assistant", content: [toolCall("1"), text("hello world")] },
      toolResult,
    ] as ModelMessage[])
    const content = (result[1] as { content: { type: string; text?: string }[] }).content
    expect(content[0]).toEqual({ type: "text", text: "hello world" })
  })
})

describe("KiloTrailingAssistant.sanitize - trailing assistant turns", () => {
  test("drops a trailing reasoning-only turn", () => {
    expect(sanitize([user, { role: "assistant", content: [reasoning("r")] }])).toBe("text")
  })

  test("drops a trailing turn containing only empty text", () => {
    expect(sanitize([user, { role: "assistant", content: [text("   ")] }])).toBe("text")
  })

  test("drops a trailing turn whose string content is blank", () => {
    expect(sanitize([user, { role: "assistant", content: "   " }])).toBe("text")
  })

  // Regression guard for the eight session.message-v2 tests that assert the
  // conversion contract: a trailing assistant turn carrying real output is
  // part of the result and must never be discarded.
  test("preserves a trailing turn that carries real text", () => {
    expect(sanitize([user, { role: "assistant", content: [text("a")] }])).toBe("text | text")
  })

  test("preserves a trailing turn with non-empty string content", () => {
    expect(sanitize([user, { role: "assistant", content: "hello" }])).toBe("text | str:hello")
  })

  test("preserves a trailing turn whose last block is text after reasoning", () => {
    expect(sanitize([user, { role: "assistant", content: [reasoning("r"), text("a")] }])).toBe("text | reasoning,text")
  })

  test("preserves an assistant-only array", () => {
    expect(sanitize([{ role: "assistant", content: [reasoning("r"), text("partial answer")] }])).toBe("reasoning,text")
  })

  test("strips trailing reasoning from a turn that has real output", () => {
    expect(sanitize([user, { role: "assistant", content: [text("a"), reasoning("r")] }])).toBe("text | text")
  })

  test("keeps a tool-call-only trailing turn, which is committed output", () => {
    expect(sanitize([user, { role: "assistant", content: [toolCall("1")] }])).toBe("text | tool-call")
  })

  test("reorders and keeps a trailing inverted turn", () => {
    expect(sanitize([user, { role: "assistant", content: [toolCall("1"), text("a")] }])).toBe("text | text,tool-call")
  })

  test("leaves an array already ending with a user message untouched", () => {
    expect(sanitize([{ role: "assistant", content: [text("a"), toolCall("1")] }, toolResult, user])).toBe(
      "text,tool-call | tool-result | text",
    )
  })

  test("handles an empty array", () => {
    expect(sanitize([])).toBe("")
  })
})
