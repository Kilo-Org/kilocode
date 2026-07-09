import { describe, expect, it } from "bun:test"
import { terminal } from "../../webview-ui/src/context/session-outcome"
import type { Message, TodoItem } from "../../webview-ui/src/types/messages"

function message(finish?: string, error?: Message["error"]): Message {
  return {
    id: "m1",
    sessionID: "s1",
    role: "assistant",
    createdAt: new Date(0).toISOString(),
    finish,
    error,
  }
}

function todo(status: TodoItem["status"]): TodoItem {
  return { id: status, content: status, status }
}

describe("terminal", () => {
  it("returns no terminal state before a turn closes", () => {
    expect(terminal({ messages: [message("stop")], todos: [] })).toBeUndefined()
  })

  it("hides normal completed turns", () => {
    expect(terminal({ reason: "completed", messages: [message("stop")], todos: [] })).toBeUndefined()
  })

  it("hides completed turns with unfinished to-dos", () => {
    expect(
      terminal({ reason: "completed", messages: [message("stop")], todos: [todo("completed"), todo("pending")] }),
    ).toBeUndefined()
  })

  it("treats cancelled to-dos as terminal rather than remaining work", () => {
    expect(terminal({ reason: "completed", messages: [message("stop")], todos: [todo("cancelled")] })).toBeUndefined()
  })

  it("surfaces response limit and unknown model finishes with unfinished to-dos", () => {
    expect(terminal({ reason: "completed", messages: [message("length")], todos: [todo("pending")] })?.kind).toBe(
      "limit",
    )
    expect(terminal({ reason: "completed", messages: [message("unknown")], todos: [] })?.kind).toBe("unknown")
  })

  it("surfaces filtered and unexpected provider finishes", () => {
    expect(terminal({ reason: "completed", messages: [message("content-filter")], todos: [] })?.kind).toBe("filtered")
    expect(terminal({ reason: "completed", messages: [message("other")], todos: [] })?.kind).toBe("unexpected")
  })

  it("surfaces interruption and failures without a rendered error", () => {
    expect(terminal({ reason: "interrupted", messages: [message("stop")], todos: [todo("pending")] })).toEqual({
      kind: "interrupted",
      tone: "warning",
      finish: "stop",
      remaining: 1,
    })
    expect(terminal({ reason: "error", messages: [message("error")], todos: [] })?.kind).toBe("error")
  })

  it("does not duplicate a concrete rendered failure", () => {
    expect(terminal({ reason: "error", messages: [message("error", { name: "APIError" })], todos: [] })).toBeUndefined()
  })

  it("retains a fallback failure when the concrete error is hidden", () => {
    expect(
      terminal({
        reason: "error",
        messages: [message("error", { name: "APIError" })],
        todos: [],
        hidden: () => true,
      })?.kind,
    ).toBe("error")
  })

  it("reports only the latest assistant finish reason", () => {
    const user: Message = { id: "u1", sessionID: "s1", role: "user", createdAt: new Date(1).toISOString() }
    expect(terminal({ reason: "completed", messages: [message("length"), user], todos: [] })?.finish).toBeUndefined()
  })
})
