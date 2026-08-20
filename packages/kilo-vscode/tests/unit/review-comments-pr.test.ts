/**
 * PR review comment payload
 *
 * GitHub PR threads travel to the agent through the same review-comment payload
 * as local diff comments. The message text must be reproducible from the part
 * metadata, otherwise a historical message loses its comment chips.
 */
import { describe, it, expect } from "bun:test"
import {
  formatReviewCommentsMarkdown,
  isPRReviewComment,
  partReview,
  parseReview,
  reviewMetadata,
  type PRReviewCommentData,
  type ReviewCommentData,
} from "../../src/shared/review-comments"
import { githubUrl, prMarkdown, prPayload, preview } from "../../webview-ui/agent-manager/pr/pr-comment-payload"
import type { PRComment } from "../../webview-ui/agent-manager/pr/pr-types"

function pr(overrides: Partial<PRReviewCommentData> = {}): PRReviewCommentData {
  return {
    id: "PRRT_1",
    origin: "pr",
    author: "alice",
    body: "This throws when gh is missing.",
    file: "src/gh.ts",
    line: 42,
    ...overrides,
  }
}

function local(): ReviewCommentData {
  return { id: "c1", file: "src/a.ts", side: "additions", line: 3, comment: "rename", selectedText: "const x = 1" }
}

function thread(overrides: Partial<PRComment> = {}): PRComment {
  return {
    id: "PRRC_1",
    threadId: "PRRT_1",
    author: "alice",
    body: "This throws when gh is missing.",
    file: "src/gh.ts",
    line: 42,
    resolved: false,
    outdated: false,
    ...overrides,
  }
}

describe("PR review comment markdown", () => {
  it("names the file, line, and author", () => {
    expect(formatReviewCommentsMarkdown([pr()])).toBe(
      "## Review Comments\n\n**src/gh.ts** (line 42), PR comment by @alice:\nThis throws when gh is missing.",
    )
  })

  it("drops the location when the thread has none", () => {
    const text = formatReviewCommentsMarkdown([pr({ file: undefined, line: undefined })])
    expect(text).toContain("PR comment by @alice:")
    expect(text).not.toContain("(line")
  })

  it("marks outdated threads", () => {
    expect(formatReviewCommentsMarkdown([pr({ outdated: true })])).toContain("by @alice (outdated):")
  })

  it("fences the diff hunk and quotes replies", () => {
    const text = formatReviewCommentsMarkdown([
      pr({
        diffHunk: "@@ -1 +1 @@\n-const x = 1\n+const x = 2",
        replies: [{ author: "bob", body: "agreed\nguard it" }],
      }),
    ])
    expect(text).toContain("```\n@@ -1 +1 @@\n-const x = 1\n+const x = 2\n```")
    expect(text).toContain("> @bob: agreed\n> guard it")
  })
})

describe("PR review comment metadata", () => {
  it("round-trips through the message body", () => {
    const data = {
      version: 1 as const,
      comments: [pr({ diffHunk: "@@ -1 +1 @@", replies: [{ author: "bob", body: "ok" }] })],
    }
    const text = `${formatReviewCommentsMarkdown(data.comments)}\n\nplease fix these`
    const view = partReview(reviewMetadata(data), text)
    expect(view?.body).toBe("please fix these")
    expect(view?.data.comments[0]).toEqual(data.comments[0])
  })

  it("round-trips a mixed local and PR payload", () => {
    const comments = [local(), pr()]
    const text = formatReviewCommentsMarkdown(comments)
    const parsed = parseReview({ version: 1, comments }, text)
    expect(parsed?.comments).toEqual(comments)
    expect(parsed?.comments.filter(isPRReviewComment)).toHaveLength(1)
  })

  it("keeps parsing a legacy local-only payload", () => {
    const comments = [local()]
    expect(parseReview({ version: 1, comments }, formatReviewCommentsMarkdown(comments))?.comments).toEqual(comments)
  })

  it("rejects an unknown origin", () => {
    const text = formatReviewCommentsMarkdown([local()])
    expect(parseReview({ version: 1, comments: [{ ...local(), origin: "gitlab" }] }, text)).toBeUndefined()
    expect(parseReview({ version: 1, comments: [local()] }, text)?.comments).toHaveLength(1)
  })

  it("rejects a PR entry with a traversal path", () => {
    const comments = [pr({ file: "../../etc/passwd" })]
    expect(parseReview({ version: 1, comments }, formatReviewCommentsMarkdown(comments))).toBeUndefined()
  })

  it("rejects a PR entry with a bogus line", () => {
    const comments = [pr({ line: 0 })]
    expect(parseReview({ version: 1, comments }, formatReviewCommentsMarkdown(comments))).toBeUndefined()
  })
})

describe("prPayload", () => {
  it("keys the payload by thread so a repeat send replaces the chip", () => {
    expect(prPayload(thread()).id).toBe("PRRT_1")
  })

  it("caps the body", () => {
    const payload = prPayload(thread({ body: "x".repeat(5_000) }))
    expect(payload.body.length).toBeLessThan(5_000)
    expect(payload.body.endsWith("...")).toBe(true)
  })

  it("keeps the hunk header and the tail of a long hunk", () => {
    const hunk = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n")
    const payload = prPayload(thread({ diffHunk: hunk }))
    const lines = payload.diffHunk?.split("\n") ?? []
    expect(lines).toHaveLength(42)
    expect(lines[0]).toBe("line 0")
    expect(lines[1]).toBe("...")
    expect(payload.diffHunk?.endsWith("line 79")).toBe(true)
  })

  it("caps a single-line hunk by characters", () => {
    const payload = prPayload(thread({ diffHunk: `@@ -1 +1 @@ ${"x".repeat(20_000)}` }))
    expect(payload.diffHunk!.length).toBeLessThan(9_000)
    expect(payload.diffHunk?.endsWith("...")).toBe(true)
  })

  it("caps replies and drops empty reply lists", () => {
    const replies = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, author: "bob", body: `reply ${i}` }))
    expect(prPayload(thread({ replies })).replies).toHaveLength(5)
    expect(prPayload(thread({ replies: [] })).replies).toBeUndefined()
  })

  it("only treats https comment urls as openable", () => {
    expect(githubUrl("http://example.com")).toBeUndefined()
    expect(githubUrl("javascript:alert(1)")).toBeUndefined()
    expect(githubUrl("https://github.com/org/repo/pull/1#discussion_r1")).toBe(
      "https://github.com/org/repo/pull/1#discussion_r1",
    )
  })

  it("survives the payload parser", () => {
    const comments = [prPayload(thread({ diffHunk: "@@ -1 +1 @@", outdated: true }))]
    expect(parseReview({ version: 1, comments }, formatReviewCommentsMarkdown(comments))?.comments).toEqual(comments)
  })

  it("formats the whole thread for the copy action", () => {
    expect(prMarkdown(thread())).toBe("**src/gh.ts** (line 42), PR comment by @alice:\nThis throws when gh is missing.")
  })
})

describe("preview", () => {
  it("uses the first meaningful line without markdown noise", () => {
    expect(preview("\n\n## Heading\nrest")).toBe("Heading")
    expect(preview("- nit: rename this")).toBe("nit: rename this")
    expect(preview("")).toBe("")
  })
})
