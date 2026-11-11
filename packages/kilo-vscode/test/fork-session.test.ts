import { describe, expect, it, mock } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { forkText } from "../src/agent-manager/fork-handoff"
import { forkSession, type ForkContext } from "../src/agent-manager/fork-session"

const noop = () => {}

// The client throws declared errors with the body fields on the error.
const emptySession = Object.assign(new Error("Cannot fork empty session: source"), {
  _tag: "InvalidRequestError",
  kind: "empty_session",
})

function session(id: string, directory = "/repo"): SessionInfo {
  return { id, location: { directory } } as SessionInfo
}

function ctx(client: unknown, overrides: Partial<ForkContext> = {}): ForkContext {
  return {
    client: async () => client as never,
    state: undefined,
    directory: "/repo",
    postError: noop,
    registerWorktreeSession: noop,
    pushState: noop,
    notifyForked: noop,
    log: noop,
    ...overrides,
  }
}

describe("agent manager fork session", () => {
  it("forks at the message boundary and records the handoff without resuming", async () => {
    const fork = mock(async () => session("forked"))
    const move = mock(async () => undefined)
    const synthetic = mock(async () => undefined)
    const notify = mock(() => undefined)

    await forkSession(
      ctx({ session: { fork, move, synthetic } }, { notifyForked: notify }),
      "source",
      undefined,
      "message",
    )

    expect(fork).toHaveBeenCalledWith({ sessionID: "source", before: "message" })
    expect(move).not.toHaveBeenCalled()
    expect(synthetic).toHaveBeenCalledWith({
      sessionID: "forked",
      text: forkText({ directory: "/repo" }),
      resume: false,
    })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: "forked" }), "source", undefined)
  })

  it("moves the fork into the selected worktree and reports its new location", async () => {
    const move = mock(async () => undefined)
    const get = mock(async () => session("forked", "/repo/.kilo/worktrees/feature"))
    const active = mock(async () => ({}))
    const synthetic = mock(async () => undefined)
    const register = mock(() => undefined)
    const addSession = mock(() => undefined)
    const notify = mock(() => undefined)
    const state = { getWorktree: () => ({ path: "/repo/.kilo/worktrees/feature" }), addSession }

    await forkSession(
      ctx(
        { session: { fork: mock(async () => session("forked")), move, get, active, synthetic } },
        { state: state as never, directory: "/repo", registerWorktreeSession: register, notifyForked: notify },
      ),
      "source",
      "worktree",
    )

    expect(move).toHaveBeenCalledWith({ sessionID: "forked", directory: "/repo/.kilo/worktrees/feature" })
    expect(synthetic).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "forked",
        text: expect.stringContaining("/repo/.kilo/worktrees/feature"),
        resume: false,
      }),
    )
    expect(addSession).toHaveBeenCalledWith("forked", "worktree")
    expect(register).toHaveBeenCalledWith("forked", "/repo/.kilo/worktrees/feature")
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: "forked", location: { directory: "/repo/.kilo/worktrees/feature" } }),
      "source",
      "worktree",
    )
  })

  it("does not move a fork that already inherits the worktree directory", async () => {
    const move = mock(async () => undefined)
    const state = { getWorktree: () => ({ path: "/repo/.kilo/worktrees/feature" }), addSession: noop }

    await forkSession(
      ctx(
        {
          session: {
            fork: mock(async () => session("forked", "/repo/.kilo/worktrees/feature")),
            move,
            synthetic: noop,
          },
        },
        { state: state as never, directory: "/repo" },
      ),
      "source",
      "worktree",
    )

    expect(move).not.toHaveBeenCalled()
  })

  it("creates a fresh session when the source has no messages", async () => {
    const get = mock(async () => ({
      id: "source",
      title: "Empty",
      agent: "code",
      model: { id: "model", providerID: "provider" },
      metadata: { kilocode: { platform: "agent-manager" } },
      location: { directory: "/repo" },
    }))
    const create = mock(async () => session("forked"))
    const notify = mock(() => undefined)
    const postError = mock(() => undefined)

    await forkSession(
      ctx(
        {
          session: {
            fork: mock(async () => {
              throw emptySession
            }),
            get,
            create,
            move: noop,
            synthetic: noop,
          },
        },
        { notifyForked: notify, postError },
      ),
      "source",
    )

    expect(create).toHaveBeenCalledWith({
      location: { directory: "/repo" },
      title: "Empty",
      agent: "code",
      model: { id: "model", providerID: "provider" },
      metadata: { kilocode: { platform: "agent-manager" } },
    })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: "forked" }), "source", undefined)
    expect(postError).not.toHaveBeenCalled()
  })

  it("reports a failed empty-session fallback", async () => {
    const postError = mock(() => undefined)
    const notify = mock(() => undefined)

    const result = await forkSession(
      ctx(
        {
          session: {
            fork: mock(async () => {
              throw emptySession
            }),
            get: mock(async () => {
              throw new Error("session not found")
            }),
          },
        },
        { postError, notifyForked: notify },
      ),
      "source",
    )

    expect(result).toBeNull()
    expect(postError).toHaveBeenCalledWith("Failed to fork session: session not found")
    expect(notify).not.toHaveBeenCalled()
  })

  it("reports other fork errors", async () => {
    const postError = mock(() => undefined)

    const result = await forkSession(
      ctx(
        {
          session: {
            fork: mock(async () => {
              throw new Error("session not found")
            }),
          },
        },
        { postError },
      ),
      "source",
    )

    expect(result).toBeNull()
    expect(postError).toHaveBeenCalledWith("Failed to fork session: session not found")
  })

  it("still exposes the fork when recording the handoff fails", async () => {
    const notify = mock(() => undefined)
    const log = mock(() => undefined)
    const client = {
      session: {
        fork: mock(async () => session("forked")),
        move: mock(async () => undefined),
        synthetic: mock(async () => {
          throw new Error("handoff failed")
        }),
      },
    }

    await forkSession(ctx(client, { notifyForked: notify, log }), "source")

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: "forked" }), "source", undefined)
    expect(log).toHaveBeenCalledWith("forkSession: failed to record fork handoff:", "handoff failed")
  })
})
