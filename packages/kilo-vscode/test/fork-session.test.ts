import { describe, expect, it, mock } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { forkText } from "../src/agent-manager/fork-handoff"
import { forkSession, type ForkContext } from "../src/agent-manager/fork-session"

const noop = () => {}

function session(id: string): SessionInfo {
  return { id } as SessionInfo
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
    expect(move).toHaveBeenCalledWith({ sessionID: "forked", directory: "/repo" })
    expect(synthetic).toHaveBeenCalledWith({
      sessionID: "forked",
      text: forkText({ directory: "/repo" }),
      resume: false,
    })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: "forked" }), "source", undefined)
  })

  it("uses the selected worktree directory and registers the fork there", async () => {
    const move = mock(async () => undefined)
    const synthetic = mock(async () => undefined)
    const register = mock(() => undefined)
    const addSession = mock(() => undefined)
    const state = { getWorktree: () => ({ path: "/repo/.kilo/worktrees/feature" }), addSession }

    await forkSession(
      ctx(
        { session: { fork: mock(async () => session("forked")), move, synthetic } },
        { state: state as never, directory: "/repo", registerWorktreeSession: register },
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
