import { describe, it, expect } from "bun:test"
import { resolveSessionAgent } from "../../webview-ui/src/context/session-agent"
import type { Message } from "../../webview-ui/src/types/messages"

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    sessionID: "sess-1",
    role: "user",
    createdAt: new Date(0).toISOString(),
    ...overrides,
  }
}

describe("resolveSessionAgent", () => {
  it("returns the latest valid user agent", () => {
    const result = resolveSessionAgent(
      [
        makeMessage({ id: "1", agent: "plan" }),
        makeMessage({ id: "2", role: "assistant", agent: "ask" }),
        makeMessage({ id: "3", agent: "code" }),
      ],
      new Set(["plan", "code", "ask"]),
    )

    expect(result).toBe("code")
  })

  it("returns the latest assistant agent when it is last", () => {
    const result = resolveSessionAgent(
      [makeMessage({ agent: "plan" }), makeMessage({ role: "assistant", agent: "code" })],
      new Set(["plan", "code"]),
    )

    expect(result).toBe("code")
  })

  it("ignores unknown agent names on assistant messages", () => {
    const result = resolveSessionAgent(
      [makeMessage({ agent: "code" }), makeMessage({ role: "assistant", agent: "task" })],
      new Set(["code"]),
    )

    expect(result).toBe("code")
  })

  it("ignores unknown agent names", () => {
    const result = resolveSessionAgent(
      [makeMessage({ agent: "missing" }), makeMessage({ agent: "code" })],
      new Set(["code"]),
    )

    expect(result).toBe("code")
  })

  it("ignores empty agent values", () => {
    const result = resolveSessionAgent([makeMessage({ agent: "  " })], new Set(["code"]))
    expect(result).toBeUndefined()
  })

  it("returns agent from assistant when no user has agent", () => {
    const result = resolveSessionAgent(
      [makeMessage({ agent: undefined }), makeMessage({ role: "assistant", agent: "code" })],
      new Set(["code"]),
    )

    expect(result).toBe("code")
  })

  it("returns undefined when no message has a valid agent", () => {
    const result = resolveSessionAgent(
      [makeMessage({ agent: undefined }), makeMessage({ role: "assistant", agent: undefined })],
      new Set(["code"]),
    )

    expect(result).toBeUndefined()
  })
})
