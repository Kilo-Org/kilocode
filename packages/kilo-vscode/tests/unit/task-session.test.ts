import { describe, expect, it } from "bun:test"
import { childID } from "../../src/kilo-provider/task-session"

describe("childID", () => {
  it("reads session ID from top-level metadata", () => {
    expect(childID({ type: "tool", tool: "task", metadata: { sessionId: "child1" } })).toBe("child1")
  })

  it("reads session ID from state metadata", () => {
    expect(childID({ type: "tool", tool: "task", state: { metadata: { sessionId: "child2" } } })).toBe("child2")
  })

  it("prefers top-level metadata over state metadata", () => {
    expect(
      childID({
        type: "tool",
        tool: "task",
        metadata: { sessionId: "top" },
        state: { metadata: { sessionId: "nested" } },
      }),
    ).toBe("top")
  })

  it("ignores non-task tool parts", () => {
    expect(childID({ type: "tool", tool: "read", state: { metadata: { sessionId: "child3" } } })).toBeUndefined()
  })
})
