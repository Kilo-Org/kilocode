import { describe, expect, it } from "bun:test"
import { restoreSessionAfterTerminal } from "../../webview-ui/agent-manager/selection-actions"

describe("Agent Manager session restoration", () => {
  it("restores the remembered session after a central terminal", () => {
    const selected: Array<[string, boolean]> = []
    const created: string[] = []

    expect(
      restoreSessionAfterTerminal({
        terminal: "terminal:one",
        remembered: "session:two",
        sessions: [{ id: "session:one" }, { id: "session:two" }],
        isPending: () => false,
        select: (id, pending) => selected.push([id, pending]),
        create: () => {
          created.push("created")
          return "pending"
        },
      }),
    ).toBe("ready")
    expect(selected).toEqual([["session:two", false]])
    expect(created).toEqual([])
  })

  it("falls back to the first session when the remembered tab is gone", () => {
    const selected: Array<[string, boolean]> = []

    expect(
      restoreSessionAfterTerminal({
        terminal: "terminal:one",
        remembered: "session:gone",
        sessions: [{ id: "pending:one" }, { id: "session:two" }],
        isPending: (id) => id.startsWith("pending:"),
        select: (id, pending) => selected.push([id, pending]),
        create: () => "pending",
      }),
    ).toBe("ready")

    expect(selected).toEqual([["pending:one", true]])
  })

  it("creates a real session tab only when no session can be restored", () => {
    const created: string[] = []

    expect(
      restoreSessionAfterTerminal({
        terminal: "terminal:one",
        remembered: undefined,
        sessions: [],
        isPending: () => false,
        select: () => undefined,
        create: () => {
          created.push("created")
          return "pending"
        },
      }),
    ).toBe("pending")
    expect(created).toEqual(["created"])
  })

  it("does nothing when no central terminal is selected", () => {
    const selected: string[] = []

    expect(
      restoreSessionAfterTerminal({
        terminal: undefined,
        remembered: "session:one",
        sessions: [{ id: "session:one" }],
        isPending: () => false,
        select: (id) => selected.push(id),
        create: () => selected.push("created"),
      }),
    ).toBe("none")
    expect(selected).toEqual([])
  })
})
