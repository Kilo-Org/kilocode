import { describe, expect, it } from "bun:test"
import { revealManagedSession, resolveManagedSession } from "../../src/agent-manager/reveal-session"

function contexts(state: {
  getSession: (id: string) => { worktreeId: string } | undefined
  getWorktree: (id: string) => unknown
}) {
  const context = { id: "project-a", peekState: () => state }
  return {
    activate: () => context,
    byDirectory: () => context,
    byLiveSession: () => undefined,
  } as never
}

describe("resolveManagedSession", () => {
  it("resolves the owning project and worktree for a tracked session", () => {
    const worktree = { id: "worktree-a", path: "/repo/worktree-a" }
    const result = resolveManagedSession(
      contexts({ getSession: () => ({ worktreeId: worktree.id }), getWorktree: () => worktree }),
      new Map([["session-a", worktree.path]]),
      "session-a",
    )

    expect(result).toMatchObject({ projectId: "project-a", sessionId: "session-a", worktreeId: "worktree-a" })
  })

  it("falls back when the worktree was removed or the directory is stale", () => {
    const result = resolveManagedSession(
      contexts({ getSession: () => ({ worktreeId: "worktree-a" }), getWorktree: () => undefined }),
      new Map([["session-a", "/repo/worktree-a"]]),
      "session-a",
    )

    expect(result).toBeUndefined()
  })

  it("activates the project before revealing and scrolling the session", async () => {
    const worktree = { id: "worktree-a", path: "/repo/worktree-a" }
    const calls: string[] = []
    const messages: unknown[] = []
    const result = await revealManagedSession(
      "session-a",
      contexts({ getSession: () => ({ worktreeId: worktree.id }), getWorktree: () => worktree }),
      {
        directories: () => new Map([["session-a", worktree.path]]),
        activate: () => calls.push("activate"),
        projects: () => calls.push("projects"),
        open: () => calls.push("open"),
        state: async () => void calls.push("state"),
        ready: async () => true,
        post: (message) => messages.push(message),
      },
    )

    expect(result).toBe(true)
    expect(calls).toEqual(["activate", "projects", "open", "state"])
    expect(messages).toEqual([
      { type: "agentManager.revealSession", projectId: "project-a", sessionId: "session-a", worktreeId: "worktree-a" },
    ])
  })
})
