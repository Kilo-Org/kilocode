import { describe, expect, it } from "bun:test"
import { revealManagedSession, resolveManagedSession } from "../../src/agent-manager/reveal-session"
import type { ProjectContexts } from "../../src/agent-manager/project/contexts"

const ROOT = "/repo"
const WORKTREE = { id: "worktree-a", path: "/repo/worktree-a" }

/** One project whose state reports the given managed sessions and worktrees. */
function contexts(
  opts: {
    sessions?: Record<string, { worktreeId: string | null }>
    worktrees?: Array<{ id: string; path: string }>
    active?: string
  } = {},
) {
  const state = {
    getSession: (id: string) => opts.sessions?.[id],
    getWorktree: (id: string) => opts.worktrees?.find((item) => item.id === id),
    getWorktrees: () => opts.worktrees ?? [],
  }
  const context = { id: "project-a", root: ROOT, peekState: () => state }
  const activated: string[] = []
  const value = {
    active: () => (opts.active === undefined ? undefined : { id: opts.active }),
    activate: (id: string) => {
      activated.push(id)
      return context
    },
    byDirectory: () => context,
    byLiveSession: () => undefined,
  } as unknown as ProjectContexts
  return { value, activated }
}

function deps(directory: string, calls: string[], messages: unknown[] = []) {
  return {
    directories: () => new Map([["session-a", directory]]),
    activate: () => calls.push("activate"),
    projects: () => calls.push("projects"),
    open: () => calls.push("open"),
    state: async () => void calls.push("state"),
    ready: async () => true,
    post: (message: unknown) => messages.push(message),
  }
}

describe("resolveManagedSession", () => {
  it("resolves the owning project and worktree for a tracked session", () => {
    const result = resolveManagedSession(
      contexts({ sessions: { "session-a": { worktreeId: WORKTREE.id } }, worktrees: [WORKTREE] }).value,
      new Map([["session-a", WORKTREE.path]]),
      "session-a",
    )

    expect(result).toMatchObject({ projectId: "project-a", sessionId: "session-a", worktreeId: WORKTREE.id })
  })

  it("falls back when the worktree was removed or the directory is stale", () => {
    const result = resolveManagedSession(
      contexts({ sessions: { "session-a": { worktreeId: WORKTREE.id } } }).value,
      new Map([["session-a", WORKTREE.path]]),
      "session-a",
    )

    expect(result).toBeUndefined()
  })

  it("resolves a session Agent Manager persisted in its Local tabs", () => {
    const result = resolveManagedSession(
      contexts({ sessions: { "session-a": { worktreeId: null } } }).value,
      new Map([["session-a", ROOT]]),
      "session-a",
    )

    expect(result).toMatchObject({ projectId: "project-a", sessionId: "session-a" })
    expect(result?.worktreeId).toBeUndefined()
  })

  it("leaves a sidebar session in the project root to the sidebar", () => {
    // The panel also tracks live sessions listed from the project root, so a
    // root directory alone must not count as Agent Manager ownership.
    const result = resolveManagedSession(contexts().value, new Map([["session-a", ROOT]]), "session-a")

    expect(result).toBeUndefined()
  })
})

describe("revealManagedSession", () => {
  it("activates the project before revealing and scrolling the session", async () => {
    const calls: string[] = []
    const messages: unknown[] = []
    const project = contexts({
      sessions: { "session-a": { worktreeId: WORKTREE.id } },
      worktrees: [WORKTREE],
      active: "project-b",
    })

    const result = await revealManagedSession("session-a", project.value, deps(WORKTREE.path, calls, messages))

    expect(result).toBe(true)
    expect(project.activated).toEqual(["project-a"])
    expect(calls).toEqual(["activate", "projects", "open", "state"])
    expect(messages).toEqual([
      { type: "agentManager.revealSession", projectId: "project-a", sessionId: "session-a", worktreeId: WORKTREE.id },
    ])
  })

  it("does not re-activate the project the panel already shows", async () => {
    // Re-activating resets PR, stats, and busy-session state, so revealing a
    // session in the current project must not touch it.
    const calls: string[] = []
    const project = contexts({
      sessions: { "session-a": { worktreeId: WORKTREE.id } },
      worktrees: [WORKTREE],
      active: "project-a",
    })

    const result = await revealManagedSession("session-a", project.value, deps(WORKTREE.path, calls))

    expect(result).toBe(true)
    expect(project.activated).toEqual([])
    expect(calls).toEqual(["open", "state"])
  })

  it("reveals a Local session without a worktree", async () => {
    const messages: unknown[] = []
    const project = contexts({ sessions: { "session-a": { worktreeId: null } }, active: "project-a" })

    const result = await revealManagedSession("session-a", project.value, deps(ROOT, [], messages))

    expect(result).toBe(true)
    expect(messages).toEqual([
      { type: "agentManager.revealSession", projectId: "project-a", sessionId: "session-a", worktreeId: undefined },
    ])
  })
})
