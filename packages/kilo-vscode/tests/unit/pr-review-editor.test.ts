import { describe, expect, it } from "bun:test"
import { handleEditorAction } from "../../src/kilo-provider/editor-actions"
import { formatReviewCommentsMarkdown, type PRReviewCommentData } from "../../src/shared/review-comments"
import { thread } from "../../src/shared/pr-review"

const comment: PRReviewCommentData = {
  id: "thread-one",
  origin: "pr",
  author: "reviewer",
  body: "Keep the previous value until the request completes.",
  file: "src/request.ts",
  line: 9,
  side: "deletions",
  originalLine: 7,
  startLine: 8,
  avatar: "https://example.com/avatar.png",
  url: "https://example.com/review",
  resolved: false,
  replies: [{ author: "author", body: "Agreed.", avatar: "https://example.com/author.png" }],
}

const message = {
  type: "openPRComment",
  sessionID: "origin-session",
  comment,
  content: formatReviewCommentsMarkdown([comment]),
}

describe("PR comment editor navigation", () => {
  it("passes validated metadata and the originating session to the diff viewer", () => {
    const opened: unknown[] = []
    expect(
      handleEditorAction(message, {
        dir: () => "/unrelated",
        openPRComment: (value, id) => opened.push({ value, id }),
      }),
    ).toBe(true)
    expect(opened).toEqual([{ value: expect.objectContaining(comment), id: "origin-session" }])
  })

  it.each([
    { ...message, content: "Not a review comment" },
    { ...message, comment: { ...comment, file: "../outside.ts" } },
    { ...message, comment: { ...comment, side: "unknown" } },
    { ...message, comment: { ...comment, avatar: "javascript:alert(1)" } },
    { ...message, comment: { ...comment, line: -1 } },
    { ...message, comment: undefined },
    { ...message, content: undefined },
  ])("rejects invalid metadata without opening a diff", (value) => {
    const opened: unknown[] = []
    expect(handleEditorAction(value, { dir: () => "/repo", openPRComment: (item) => opened.push(item) })).toBe(true)
    expect(opened).toEqual([])
  })

  it("reconstructs a thread without losing its identity, side, avatars or replies", () => {
    expect(thread(comment)).toEqual({
      id: comment.id,
      threadId: comment.id,
      author: comment.author,
      avatar: comment.avatar,
      body: comment.body,
      file: comment.file,
      line: comment.line,
      side: comment.side,
      originalLine: comment.originalLine,
      startLine: comment.startLine,
      url: comment.url,
      resolved: false,
      outdated: false,
      diffHunk: undefined,
      replies: comment.replies,
    })
  })
})
