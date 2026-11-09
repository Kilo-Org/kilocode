import { describe, expect, it, mock } from "bun:test"
import { routeWorktreeMessage, type ChatWorktree } from "../src/chat"
import type { ToWebview } from "../src/protocol"

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(overrides: Partial<ChatWorktree> = {}) {
  const posts: ToWebview[] = []
  const continueAction = mock(
    async (_sessionId: string, progress: (status: string, detail?: string, error?: string) => void) => {
      progress("capturing", "Capturing")
      progress("done")
    },
  )
  const createAction = mock(async () => undefined)
  const advancedAction = mock(async () => undefined)
  const worktree: ChatWorktree = {
    continue: continueAction,
    create: createAction,
    advanced: advancedAction,
    branch: async () => "main",
    ...overrides,
  }
  return {
    worktree,
    posts,
    post: (message: ToWebview) => posts.push(message),
    continueAction,
    createAction,
    advancedAction,
  }
}

describe("sidebar worktree host messages", () => {
  it("reports the branch from the worktree hooks", async () => {
    const { worktree, post, posts } = setup()

    expect(routeWorktreeMessage({ type: "agentManager.requestRepoInfo" }, worktree, post)).toBe(true)
    await flush()

    expect(posts).toEqual([{ type: "agentManager.repoInfo", branch: "main" }])
  })

  it("forwards move progress to the sidebar", async () => {
    const { worktree, post, posts, continueAction } = setup()

    expect(routeWorktreeMessage({ type: "continueInWorktree", sessionId: "ses_1" }, worktree, post)).toBe(true)
    await flush()

    expect(continueAction).toHaveBeenCalledWith("ses_1", expect.any(Function))
    expect(posts[0]).toMatchObject({ type: "continueInWorktreeProgress", status: "capturing", detail: "Capturing" })
    expect(posts[1]).toMatchObject({ type: "continueInWorktreeProgress", status: "done" })
  })

  it("reports a missing worktree bridge", () => {
    const { post, posts } = setup()

    expect(routeWorktreeMessage({ type: "continueInWorktree", sessionId: "ses_1" }, undefined, post)).toBe(true)

    expect(posts).toEqual([
      { type: "continueInWorktreeProgress", status: "error", error: "Continue in Worktree is not available" },
    ])
  })

  it("forwards worktree creation and its failure", async () => {
    const { worktree, post, posts, createAction } = setup()

    expect(
      routeWorktreeMessage(
        { type: "agentManager.createWorktree", baseBranch: "main", branchName: "feature" },
        worktree,
        post,
      ),
    ).toBe(true)
    await flush()
    expect(createAction).toHaveBeenCalledWith("main", "feature")

    const failing = setup({
      create: async () => {
        throw new Error("create failed")
      },
    })
    routeWorktreeMessage({ type: "agentManager.createWorktree" }, failing.worktree, failing.post)
    await flush()
    expect(failing.posts).toEqual([{ type: "continueInWorktreeProgress", status: "error", error: "create failed" }])
    expect(posts).toEqual([])
  })

  it("opens the advanced worktree dialog", async () => {
    const { worktree, post, advancedAction } = setup()

    expect(routeWorktreeMessage({ type: "openAdvancedWorktree" }, worktree, post)).toBe(true)
    await flush()

    expect(advancedAction).toHaveBeenCalledWith()
  })

  it("ignores unrelated messages", () => {
    const { worktree, post } = setup()

    expect(routeWorktreeMessage({ type: "abort", id: 1 }, worktree, post)).toBe(false)
  })
})
