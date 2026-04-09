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

  it("ignores assistant messages", () => {
    const result = resolveSessionAgent(
      [makeMessage({ role: "assistant", agent: "code" }), makeMessage({ agent: "plan" })],
      new Set(["plan", "code"]),
    )

    expect(result).toBe("plan")
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

  it("returns undefined when no valid user agent exists", () => {
    const result = resolveSessionAgent(
      [makeMessage({ role: "assistant", agent: "code" }), makeMessage({ agent: undefined })],
      new Set(["code"]),
    )

    expect(result).toBeUndefined()
  })
})
