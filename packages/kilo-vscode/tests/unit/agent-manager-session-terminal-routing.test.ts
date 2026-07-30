import { describe, expect, it, mock } from "bun:test"
import { routeSessionTerminal } from "../../src/agent-manager/session-terminal-routing"

function scene(destination: "vscode" | "agentManager") {
  const calls = {
    side: mock(() => {}),
    session: mock((_sessionId: string, _state: unknown) => {}),
    local: mock(() => {}),
    worktree: mock((_worktreeId: string, _state: unknown) => {}),
  }
  const state = { marker: true }
  const route = {
    destination,
    state: state as never,
    terminals: {
      showTerminal: calls.session,
      showLocalTerminal: calls.local,
      showWorktreeTerminal: calls.worktree,
    },
    openSide: calls.side,
  }
  return { calls, route, state }
}

describe("Agent Manager session terminal routing", () => {
  it("routes every scoped request to the embedded terminal destination", () => {
    const item = scene("agentManager")

    expect(routeSessionTerminal({ type: "agentManager.showTerminal", sessionId: "session-1" }, item.route)).toBe(true)
    expect(routeSessionTerminal({ type: "agentManager.showLocalTerminal" }, item.route)).toBe(true)
    expect(
      routeSessionTerminal({ type: "agentManager.showWorktreeTerminal", worktreeId: "worktree-1" }, item.route),
    ).toBe(true)

    expect(item.calls.side).toHaveBeenCalledTimes(3)
    expect(item.calls.session).not.toHaveBeenCalled()
    expect(item.calls.local).not.toHaveBeenCalled()
    expect(item.calls.worktree).not.toHaveBeenCalled()
  })

  it("preserves the VS Code terminal behavior for every request shape", () => {
    const item = scene("vscode")

    routeSessionTerminal({ type: "agentManager.showTerminal", sessionId: "session-1" }, item.route)
    routeSessionTerminal({ type: "agentManager.showLocalTerminal" }, item.route)
    routeSessionTerminal({ type: "agentManager.showWorktreeTerminal", worktreeId: "worktree-1" }, item.route)

    expect(item.calls.session).toHaveBeenCalledWith("session-1", item.state)
    expect(item.calls.local).toHaveBeenCalledTimes(1)
    expect(item.calls.worktree).toHaveBeenCalledWith("worktree-1", item.state)
    expect(item.calls.side).not.toHaveBeenCalled()
  })

  it("ignores unrelated messages", () => {
    const item = scene("agentManager")

    expect(routeSessionTerminal({ type: "agentManager.openWorktree" }, item.route)).toBe(false)
    expect(item.calls.side).not.toHaveBeenCalled()
  })
})
