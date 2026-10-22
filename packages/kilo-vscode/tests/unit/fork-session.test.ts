import { describe, expect, it, mock } from "bun:test"
import type { Session } from "@kilocode/sdk/v2/client"
import { forkText } from "../../src/agent-manager/fork-handoff"
import { forkSession, type ForkContext } from "../../src/agent-manager/fork-session"

const noop = () => {}

function session(id: string): Session {
  return { id, title: id, createdAt: "", updatedAt: "" } as Session
}

function ctx(client: unknown, overrides: Partial<ForkContext> = {}): ForkContext {
  return {
    getClient: () => client as never,
    state: undefined,
    directory: "/repo",
    postError: noop,
    registerWorktreeSession: noop,
    pushState: noop,
    notifyForked: noop,
    registerSession: noop,
    log: noop,
    ...overrides,
  }
}

describe("agent manager fork session", () => {
  it("records the hidden handoff in the current repository", async () => {
    const fork = mock(async () => ({ data: session("forked") }))
    const promptAsync = mock(async () => ({}))
    const client = { session: { fork, promptAsync } }

    await forkSession(ctx(client), "source", undefined, "message")

    expect(fork).toHaveBeenCalledWith(
      { sessionID: "source", directory: "/repo", messageID: "message" },
      { throwOnError: true },
    )
    expect(promptAsync).toHaveBeenCalledWith(
      {
        sessionID: "forked",
        directory: "/repo",
        noReply: true,
        parts: [{ type: "text", text: forkText({ directory: "/repo" }), synthetic: true }],
      },
      { throwOnError: true },
    )
  })

  it("uses the selected worktree directory for the handoff", async () => {
    const fork = mock(async () => ({ data: session("forked") }))
    const promptAsync = mock(async () => ({}))
    const client = { session: { fork, promptAsync } }
    const state = {
      getWorktree: () => ({ path: "/repo/.kilo/worktrees/feature" }),
      addSession: mock(() => undefined),
    }

    await forkSession(ctx(client, { state: state as never }), "source", "worktree")

    expect(fork).toHaveBeenCalledWith(
      { sessionID: "source", directory: "/repo/.kilo/worktrees/feature" },
      { throwOnError: true },
    )
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ directory: "/repo/.kilo/worktrees/feature" }), {
      throwOnError: true,
    })
  })

  it("still exposes the fork when recording the handoff fails", async () => {
    const notify = mock(() => undefined)
    const log = mock(() => undefined)
    const client = {
      session: {
        fork: mock(async () => ({ data: session("forked") })),
        promptAsync: mock(async () => {
          throw new Error("handoff failed")
        }),
      },
    }

    await forkSession(ctx(client, { notifyForked: notify, log }), "source")

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: "forked" }), "source", undefined)
    expect(log).toHaveBeenCalledWith("forkSession: failed to record fork handoff:", "handoff failed")
  })
})
