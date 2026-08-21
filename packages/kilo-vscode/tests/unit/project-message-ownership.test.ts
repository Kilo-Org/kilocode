import { describe, expect, it } from "bun:test"
import { ownsParent, ownsProject } from "../../webview-ui/agent-manager/project/message-ownership"

describe("project message ownership", () => {
  it("rejects messages from another project", () => {
    expect(ownsProject({ projectId: "a" }, "b")).toBe(false)
    expect(ownsProject({}, "b")).toBe(true)
  })

  it("resolves parent session ownership", () => {
    const states = { a: { sessions: [{ id: "s-a" }] }, b: { sessions: [{ id: "s-b" }] } }
    expect(ownsParent(states, "s-a", "a")).toBe(true)
    expect(ownsParent(states, "s-a", "b")).toBe(false)
  })
})
