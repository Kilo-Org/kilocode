import { describe, expect, it } from "bun:test"
import { postAllGithub, resolveGithubContext, type CommentsGithub } from "../../webview-ui/diff-viewer/comments-github"
import type { PRDiffSnapshot, PRTarget } from "../../src/shared/pr-comment-actions"
import type { ReviewComment } from "../../webview-ui/diff-viewer/review-comments"

const patch = "@@ -1,2 +1,2 @@\n context\n-old\n+new\n"

const target: PRTarget = {
  worktreeId: "wt-1",
  prNumber: 7,
  prUrl: "https://github.com/example/repo/pull/7",
}

const snapshot: PRDiffSnapshot = {
  id: "snap-1",
  head: "a".repeat(40),
  files: [{ path: "src/file.ts", status: "modified", patch }],
}

function comment(id: string, line: number): ReviewComment {
  return { id, file: "src/file.ts", side: "additions", line, comment: id, selectedText: "" }
}

function fake(handler: (comment: ReviewComment) => { success: boolean; error?: string }): CommentsGithub {
  return {
    available: () => true,
    resolve: () => undefined,
    send: async (item) => handler(item),
  }
}

describe("resolveGithubContext", () => {
  it("accepts a line inside the PR hunk", () => {
    const result = resolveGithubContext({
      target,
      snapshot,
      file: "src/file.ts",
      side: "additions",
      start: 2,
      end: 2,
      patch,
    })
    expect(result).toEqual({
      prNumber: 7,
      prUrl: target.prUrl,
      snapshotId: "snap-1",
      label: "GitHub #7",
      closed: false,
    })
  })

  it("marks a line outside the hunk as closed", () => {
    const result = resolveGithubContext({
      target,
      snapshot,
      file: "src/file.ts",
      side: "additions",
      start: 9,
      end: 9,
      patch,
    })
    expect(result?.closed).toBe(true)
  })

  it("marks a missing patch as closed", () => {
    const result = resolveGithubContext({
      target,
      snapshot,
      file: "src/file.ts",
      side: "additions",
      start: 2,
      end: 2,
    })
    expect(result?.closed).toBe(true)
  })

  it("returns undefined without a target or snapshot", () => {
    expect(
      resolveGithubContext({ snapshot, file: "src/file.ts", side: "additions", start: 2, end: 2, patch }),
    ).toBeUndefined()
    expect(
      resolveGithubContext({ target, file: "src/file.ts", side: "additions", start: 2, end: 2, patch }),
    ).toBeUndefined()
  })
})

describe("postAllGithub", () => {
  it("posts every comment in order when each request succeeds", async () => {
    const sent: string[] = []
    const result = await postAllGithub(
      [comment("first", 2), comment("second", 1)],
      fake((item) => {
        sent.push(item.id)
        return { success: true }
      }),
    )
    expect(sent).toEqual(["first", "second"])
    expect(result.posted.map((item) => item.id)).toEqual(["first", "second"])
    expect(result.failure).toBeUndefined()
  })

  it("stops at the first failure and keeps the unposted comments", async () => {
    const sent: string[] = []
    const result = await postAllGithub(
      [comment("first", 2), comment("second", 1), comment("third", 1)],
      fake((item) => {
        sent.push(item.id)
        return item.id === "second" ? { success: false, error: "boom" } : { success: true }
      }),
    )
    expect(sent).toEqual(["first", "second"])
    expect(result.posted.map((item) => item.id)).toEqual(["first"])
    expect(result.failure).toBe("boom")
  })
})
