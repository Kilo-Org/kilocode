import { describe, expect, it, mock } from "bun:test"
import { createDiffCommentActions } from "../../src/diff/comment-actions"
import type { PRStatus } from "../../src/agent-manager/types"
import { createDiffPRPolling, type DiffPRPollerOptions } from "../../src/diff/pr-poller"

function harness() {
  const pr = {
    number: 42,
    url: "https://github.com/example/repo/pull/42",
    comments: {
      total: 1,
      unresolved: 1,
      comments: [
        {
          id: "root",
          threadId: "thread",
          author: "owner",
          body: "Review",
          resolved: false,
          outdated: false,
          canEdit: true,
          canDelete: true,
          replies: [{ id: "reply", author: "owner", body: "Reply", canEdit: true, canDelete: true }],
        },
      ],
    },
  } as PRStatus
  const initial = { token: "panel-generation-1", directory: "/host/repo", branch: "feature", pr }
  let ctx: typeof initial | undefined = initial
  const branch = Promise.withResolvers<string>()
  const response = Promise.withResolvers<Record<string, unknown>>()
  const mutation = Promise.withResolvers<void>()
  const calls: unknown[][] = []
  const write = mock(async (...args: unknown[]) => {
    calls.push(args)
    await mutation.promise
  })
  const refresh = mock(() => undefined)
  const post = mock((message: Record<string, unknown>) => response.resolve(message))
  const handler = createDiffCommentActions({
    context: () => ctx,
    branch: () => branch.promise,
    post,
    refresh,
    log: () => undefined,
    actions: { reply: write, resolve: write, unresolve: write, mutate: write },
  })
  const message = {
    type: "agentManager.replyComment",
    projectId: initial.token,
    worktreeId: "diff",
    threadId: "thread",
    requestId: "request",
    body: "  line one\n\n```suggestion\nline two\n```\n",
    prNumber: 42,
    prUrl: pr.url,
  }
  return {
    handler,
    initial,
    message,
    calls,
    refresh,
    post,
    branch,
    response,
    mutation,
    set: (next: typeof ctx) => {
      ctx = next
    },
  }
}

describe("standalone diff comment routing", () => {
  for (const type of ["replyComment", "resolveComment", "unresolveComment", "mutateComment"]) {
    it(`routes ${type} using the host directory and refreshes after success`, async () => {
      const h = harness()
      const message = {
        ...h.message,
        type: `agentManager.${type}`,
        action: "edit",
        commentId: "reply",
        cwd: "/untrusted",
      }
      expect(h.handler.handle(message)).toBe(true)
      h.branch.resolve("feature")
      h.mutation.resolve()
      const result = await h.response.promise
      expect(result).toMatchObject({
        type: `${message.type}Result`,
        projectId: h.initial.token,
        requestId: "request",
        success: true,
      })
      expect(h.calls).toHaveLength(1)
      expect(h.calls[0]?.at(-1)).toBe("/host/repo")
      if (type === "replyComment") expect(h.calls[0]?.at(1)).toBe(message.body)
      expect(h.refresh).toHaveBeenCalledTimes(1)
    })
  }

  for (const patch of [
    { projectId: "previous-generation" },
    { worktreeId: "foreign" },
    { prNumber: 43 },
    { prUrl: "https://github.com/other/repo/pull/42" },
    { threadId: "historical" },
    { body: " \n " },
    { type: "agentManager.mutateComment", action: "create" },
    { type: "agentManager.mutateComment", action: "delete", commentId: "foreign" },
  ]) {
    it(`rejects invalid routing or membership ${JSON.stringify(patch)}`, async () => {
      const h = harness()
      h.handler.handle({ ...h.message, ...patch })
      expect(await h.response.promise).toMatchObject({ success: false })
      expect(h.calls).toHaveLength(0)
      expect(h.refresh).not.toHaveBeenCalled()
    })
  }

  it.each(["branch", "membership", "generation"])("rechecks %s after the branch read", async (change) => {
    const h = harness()
    h.handler.handle(
      change === "membership"
        ? { ...h.message, type: "agentManager.mutateComment", action: "delete", commentId: "reply" }
        : h.message,
    )
    if (change === "membership")
      h.set({ ...h.initial, pr: { ...h.initial.pr, comments: { total: 0, unresolved: 0, comments: [] } } })
    if (change === "generation") h.set({ ...h.initial, token: "panel-generation-2" })
    h.branch.resolve(change === "branch" ? "other" : "feature")
    expect(await h.response.promise).toMatchObject({
      success: false,
      projectId: h.initial.token,
      requestId: "request",
    })
    expect(h.calls).toHaveLength(0)
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it("settles the original scoped request without refreshing a new context", async () => {
    const h = harness()
    h.handler.handle(h.message)
    h.branch.resolve("feature")
    await Promise.resolve()
    expect(h.calls).toHaveLength(1)
    h.set(undefined)
    h.mutation.resolve()
    expect(await h.response.promise).toMatchObject({ success: true, projectId: h.initial.token, requestId: "request" })
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it("reports failures without refreshing or retrying", async () => {
    const h = harness()
    h.handler.handle(h.message)
    h.branch.resolve("feature")
    h.mutation.reject(new Error("offline"))
    expect(await h.response.promise).toMatchObject({ success: false, error: "offline" })
    expect(h.calls).toHaveLength(1)
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it("does not accept unsupported suggestion actions", () => {
    const h = harness()
    expect(h.handler.handle({ ...h.message, type: "agentManager.applyPRSuggestion" })).toBe(false)
    expect(h.calls).toHaveLength(0)
  })
})

it("refreshes the active diff poller and rejects old polling generations", () => {
  const callbacks: DiffPRPollerOptions[] = []
  const refresh = mock(() => undefined)
  const polling = createDiffPRPolling({
    onStatus: () => undefined,
    log: () => undefined,
    createPoller: (opts) => {
      callbacks.push(opts)
      return {
        refresh,
        stop: () => undefined,
        setActiveWorktreeId: () => undefined,
        setEnabled: () => undefined,
        setVisible: () => undefined,
      }
    },
  })
  const pr = harness().initial.pr
  polling.sync({ workspaceRoot: "/first" }, undefined, true)
  callbacks[0]!.onStatus("diff", pr, undefined, "first-branch")
  expect(polling.getStatus()).toBe(pr)
  expect(polling.getBranch()).toBe("first-branch")
  polling.refresh()
  expect(refresh).toHaveBeenCalledWith("diff")
  polling.sync({ workspaceRoot: "/second" }, undefined, true)
  callbacks[0]!.onStatus("diff", pr, undefined, "first-branch")
  expect(polling.getStatus()).toBeUndefined()
  expect(polling.getBranch()).toBeUndefined()
  callbacks[1]!.onStatus("diff", pr, undefined, "second-branch")
  expect(polling.getBranch()).toBe("second-branch")
  polling.stop()
  polling.refresh()
  expect(refresh).toHaveBeenCalledTimes(1)
})
