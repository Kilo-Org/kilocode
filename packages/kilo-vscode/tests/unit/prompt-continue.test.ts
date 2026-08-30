import { describe, expect, it } from "bun:test"
import { continuation } from "../../webview-ui/src/context/session-continuation"
import type { Message, Part } from "../../webview-ui/src/types/messages"

const user: Message = { id: "user", sessionID: "session", role: "user", createdAt: "2026-01-01" }
const assistant: Message = {
  id: "assistant",
  sessionID: "session",
  role: "assistant",
  parentID: user.id,
  createdAt: "2026-01-01",
  error: { name: "MessageAbortedError" },
}
const input = {
  id: "session",
  status: "idle",
  messages: [user, assistant],
  parts: (_: string): Part[] => [],
  submitting: false,
  blocked: false,
  loading: false,
  reverted: false,
}

describe("empty prompt continuation", () => {
  it("targets the stopped assistant rather than creating a new user turn", () => {
    expect(continuation(input)).toBe(assistant.id)
    expect(continuation({ ...input, messages: [user, { ...assistant, finish: "stop" }] })).toBe(assistant.id)
  })

  it("accepts unfinished assistant and tool-call turns", () => {
    for (const finish of [undefined, "tool-calls"]) {
      expect(continuation({ ...input, messages: [user, { ...assistant, error: undefined, finish }] })).toBe(
        assistant.id,
      )
    }
  })

  it("does not resume completed, filtered, limited, or failed responses", () => {
    for (const finish of ["stop", "length", "unknown", "content-filter", "error"]) {
      expect(continuation({ ...input, messages: [user, { ...assistant, error: undefined, finish }] })).toBeUndefined()
    }
    expect(continuation({ ...input, messages: [user, { ...assistant, error: { name: "APIError" } }] })).toBeUndefined()
  })

  it("does not resume empty chats, previews, or a different user turn", () => {
    expect(continuation({ ...input, id: undefined })).toBeUndefined()
    expect(continuation({ ...input, id: "cloud:preview" })).toBeUndefined()
    expect(continuation({ ...input, messages: [] })).toBeUndefined()
    expect(continuation({ ...input, messages: [user] })).toBeUndefined()
    expect(continuation({ ...input, messages: [user, { ...assistant, parentID: "older-user" }] })).toBeUndefined()
    expect(continuation({ ...input, messages: [user, assistant, { ...user, id: "next-user" }] })).toBeUndefined()
    expect(continuation({ ...input, messages: [user, { ...assistant, summary: true }] })).toBeUndefined()
  })

  it("keeps busy, pending, blocked, loading, and reverted sessions unavailable", () => {
    for (const status of ["busy", "retry", "offline"]) {
      expect(continuation({ ...input, status })).toBeUndefined()
    }
    for (const key of ["submitting", "blocked", "loading", "reverted"] as const) {
      expect(continuation({ ...input, [key]: true })).toBeUndefined()
    }
  })
})
