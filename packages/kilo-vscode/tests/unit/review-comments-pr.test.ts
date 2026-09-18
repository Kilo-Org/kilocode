/**
 * PR review comment payload
 *
 * GitHub PR threads travel to the agent through the same review-comment payload
 * as local diff comments. The message text must be reproducible from the part
 * metadata, otherwise a historical message loses its comment chips.
 */
import { describe, it, expect } from "bun:test"
import {
  formatReviewCommentMarkdown,
  formatReviewCommentsMarkdown,
  isPRReviewComment,
  partReview,
  parseReview,
  pushInstruction,
  reviewMetadata,
  type CIReviewCommentData,
  type PRReviewCommentData,
  type ReviewCommentData,
} from "../../src/shared/review-comments"
import {
  displayHunk,
  githubUrl,
  prMarkdown,
  prPayload,
  preview,
} from "../../webview-ui/agent-manager/pr/pr-comment-payload"
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

function ci(overrides: Partial<CIReviewCommentData> = {}): CIReviewCommentData {
  return {
    id: "ci:42:100",
    origin: "ci",
    title: "Typecheck failed",
    body: "Inspect the failed typecheck job before making a fix.",
    ...overrides,
  }
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

  it("formats review state when present", () => {
    const approved = formatReviewCommentsMarkdown([pr({ file: undefined, line: undefined, reviewState: "approved" })])
    expect(approved).toContain("PR review (approved) by @alice:")

    const changes = formatReviewCommentsMarkdown([
      pr({ file: undefined, line: undefined, reviewState: "changes_requested" }),
    ])
    expect(changes).toContain("PR review (changes requested) by @alice:")
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

describe("push instruction", () => {
  it("asks for commit and push only for PR or CI feedback when enabled", () => {
    expect(pushInstruction([pr()], true)).toContain("commit them and push to this branch")
    expect(pushInstruction([ci()], true)).toContain("Do not force-push")
    expect(pushInstruction([local(), pr()], true)).not.toBe("")
    expect(pushInstruction([local()], true)).toBe("")
    expect(pushInstruction([pr(), ci()], false)).toBe("")
  })

  it("keeps the review chips when appended after the review block", () => {
    const comments = [ci()]
    const text = [formatReviewCommentsMarkdown(comments), pushInstruction(comments, true)].join("\n\n")
    const view = partReview(reviewMetadata({ version: 1, comments }), text)
    expect(view?.data.comments).toEqual(comments)
    expect(view?.body).toBe(pushInstruction(comments, true))
  })
})

describe("PR review comment metadata", () => {
  it("round-trips through the message body", () => {
    const data = {
      version: 1 as const,
      comments: [pr({ diffHunk: "@@ -1 +1 @@", reviewState: "approved", replies: [{ author: "bob", body: "ok" }] })],
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

  it("rejects invalid optional PR location and URL fields", () => {
    const valid = pr({ side: "deletions", originalLine: 41, startLine: 40, url: "https://github.com/org/repo/pull/1" })
    const text = formatReviewCommentsMarkdown([valid])
    expect(parseReview({ version: 1, comments: [{ ...valid, side: "context" }] }, text)).toBeUndefined()
    expect(parseReview({ version: 1, comments: [{ ...valid, originalLine: 0 }] }, text)).toBeUndefined()
    expect(parseReview({ version: 1, comments: [{ ...valid, startLine: 0 }] }, text)).toBeUndefined()
    expect(
      parseReview({ version: 1, comments: [{ ...valid, url: "http://github.com/org/repo/pull/1" }] }, text),
    ).toBeUndefined()
    expect(parseReview({ version: 1, comments: [{ ...valid, avatar: "javascript:alert(1)" }] }, text)).toBeUndefined()
  })

  it("ignores unknown optional fields in old metadata", () => {
    const comment = { ...pr(), future: { value: true } }
    const text = formatReviewCommentsMarkdown([comment])
    expect(parseReview({ version: 1, comments: [comment] }, text)?.comments).toEqual([pr()])
  })
})

describe("CI review comment metadata", () => {
  it("round-trips CI metadata with and without a visible message body", () => {
    const data = { version: 1 as const, comments: [ci({ body: "Failed: `typecheck`\n\nRead logs on demand." })] }
    const text = formatReviewCommentsMarkdown(data.comments)
    const metadata = JSON.parse(JSON.stringify(reviewMetadata(data)))
    expect(partReview(metadata, text)).toEqual({ data, body: "" })
    expect(partReview(metadata, `${text}\n\nFix only these failures.`)).toEqual({
      data,
      body: "Fix only these failures.",
    })
  })

  it("round-trips mixed local, PR, and CI metadata", () => {
    const data = { version: 1 as const, comments: [local(), pr(), ci()] }
    const text = formatReviewCommentsMarkdown(data.comments)
    const metadata = JSON.parse(JSON.stringify(reviewMetadata(data)))
    expect(partReview(metadata, text)).toEqual({ data, body: "" })
  })

  it("rejects an oversized CI body", () => {
    const comments = [ci({ body: "x".repeat(16_001) })]
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

  it("crops the correct side when both sides have the same line number", () => {
    const hunk = [
      "@@ -1,80 +1,80 @@",
      ...Array.from({ length: 80 }, (_, i) => `-old ${i + 1}`),
      ...Array.from({ length: 80 }, (_, i) => `+new ${i + 1}`),
    ].join("\n")
    const removed = displayHunk(hunk, 10, undefined, "deletions")
    const added = displayHunk(hunk, 10, undefined, "additions")
    expect(removed.patch).toContain("-old 10")
    expect(removed.patch).not.toContain("+new 10")
    expect(added.patch).toContain("+new 10")
    expect(added.patch).not.toContain("-old 10")
    expect(prPayload(thread({ diffHunk: hunk, line: 10, side: "deletions" })).diffHunk).toContain("-old 10")
    expect(prPayload(thread({ diffHunk: hunk, line: 10, side: "deletions" })).diffHunk).not.toContain("+new 10")
  })

  it("uses the original hunk line for a comment whose current location moved", () => {
    const hunk = ["@@ -0,0 +1,80 @@", ...Array.from({ length: 80 }, (_, i) => `+line ${i + 1}`)].join("\n")
    const value = prPayload(thread({ diffHunk: hunk, line: 70, originalLine: 30, side: "additions" }))
    expect(value.line).toBe(70)
    expect(value.diffHunk).toContain("+line 30")
    expect(value.diffHunk).not.toContain("+line 70")
  })

  it("does not append current-worktree context to a deleted-side hunk", () => {
    const view = displayHunk("@@ -1 +1,0 @@\n-old", 1, ["unrelated current line"], "deletions")
    expect(view.patch).toContain("-old")
    expect(view.patch).not.toContain("unrelated current line")
  })

  it("crops a full-file hunk around the commented line", () => {
    const hunk = ["@@ -1 +1,80 @@", ...Array.from({ length: 80 }, (_, i) => `+line ${i + 1}`)].join("\n")
    const view = displayHunk(hunk, 70)
    const lines = view.patch.split("\n")

    expect(lines).toHaveLength(8)
    expect(lines[0]).toBe("@@ -1,0 +67,7 @@")
    expect(lines[1]).toBe("+line 67")
    expect(lines).toContain("+line 70")
    expect(lines.at(-1)).toBe("+line 73")
    expect(view.top).toBe(true)
    expect(view.bottom).toBe(true)
  })

  // GitHub truncates diffHunk at the commented line, so hunk length says nothing
  // about how much context a comment deserves. Every card renders one window:
  // three lines, the commented line, then three more from the hunk when it has
  // them and from the worktree when it does not.
  it("renders the same window whatever the hunk length", () => {
    const build = (count: number) =>
      [`@@ -0,0 +1,${count} @@`, ...Array.from({ length: count }, (_, i) => `+line ${i + 1}`)].join("\n")
    const short = displayHunk(build(34), 34)
    const long = displayHunk(build(172), 168)

    expect(short.lines.map((item) => item.text)).toEqual(["31", "32", "33", "34"].map((n) => `+line ${n}`))
    expect(long.lines.map((item) => item.text)).toEqual(
      ["165", "166", "167", "168", "169", "170", "171"].map((n) => `+line ${n}`),
    )
    expect(short.top).toBe(true)
    expect(short.bottom).toBe(false)
    expect(long.top).toBe(true)
    expect(long.bottom).toBe(true)
  })

  // A hunk stops at the commented line, so a warning about what runs next has
  // nothing to point at. The worktree lines continue the snippet as context.
  it("continues the snippet with worktree lines below the commented line", () => {
    const hunk = [
      "@@ -1,1 +1,3 @@",
      " function open() {",
      "+  const event = build()",
      "+  event.preventDefault()",
    ].join("\n")
    const view = displayHunk(hunk, 3, ["  return dispatch(event)", "}", "", "extra"])

    expect(view.patch.split("\n")).toEqual([
      "@@ -1,4 +1,6 @@",
      " function open() {",
      "+  const event = build()",
      "+  event.preventDefault()",
      "   return dispatch(event)",
      " }",
      " ",
    ])
    expect(view.bottom).toBe(true)
  })

  it("keeps the GitHub window when the worktree has no matching context", () => {
    const hunk = [
      "@@ -1,1 +1,3 @@",
      " function open() {",
      "+  const event = build()",
      "+  event.preventDefault()",
    ].join("\n")
    const view = displayHunk(hunk, 3)

    expect(view.lines).toHaveLength(3)
    expect(view.bottom).toBe(false)
  })

  it("gives the agent the worktree context too", () => {
    const hunk = ["@@ -1,1 +1,2 @@", " function open() {", "+  event.preventDefault()"].join("\n")
    const payload = prPayload(thread({ diffHunk: hunk, line: 2, after: ["  return dispatch(event)", "}"] }))

    expect(payload.diffHunk?.split("\n")).toEqual([
      "@@ -1,3 +1,4 @@",
      " function open() {",
      "+  event.preventDefault()",
      "   return dispatch(event)",
      " }",
      "...",
    ])
  })

  it("gives the agent more of the hunk than the card renders", () => {
    const hunk = ["@@ -0,0 +1,80 @@", ...Array.from({ length: 80 }, (_, i) => `+line ${i + 1}`)].join("\n")
    const payload = prPayload(thread({ diffHunk: hunk, line: 40 }))
    const lines = payload.diffHunk?.split("\n") ?? []

    expect(lines[0]).toBe("@@ -0,0 +16,33 @@")
    expect(lines[1]).toBe("...")
    expect(lines).toContain("+line 40")
    expect(lines.at(-1)).toBe("...")
    expect(lines.length).toBeGreaterThan(displayHunk(hunk, 40).lines.length)
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

  it("preserves location, resolution, and safe avatar metadata", () => {
    const value = thread({
      avatar: "https://avatar/alice",
      side: "deletions",
      originalLine: 41,
      startLine: 40,
      url: "https://github.com/org/repo/pull/1#discussion_r1",
      resolved: true,
      replies: [{ author: "bob", body: "ok", avatar: "https://avatar/bob" }],
    })
    expect(prPayload(value)).toEqual(
      expect.objectContaining({
        avatar: "https://avatar/alice",
        side: "deletions",
        originalLine: 41,
        startLine: 40,
        url: "https://github.com/org/repo/pull/1#discussion_r1",
        resolved: true,
        replies: [{ author: "bob", body: "ok", avatar: "https://avatar/bob" }],
      }),
    )
  })

  it("drops unsafe URLs and avatars from the payload", () => {
    const payload = prPayload(
      thread({
        avatar: "http://avatar/alice",
        url: "javascript:alert(1)",
        replies: [{ author: "bob", body: "ok", avatar: "data:text/plain,bad" }],
      }),
    )
    expect(payload).not.toHaveProperty("avatar")
    expect(payload).not.toHaveProperty("url")
    expect(payload.replies).toEqual([{ author: "bob", body: "ok" }])
  })

  it("only treats https comment urls as openable", () => {
    expect(githubUrl("http://example.com")).toBeUndefined()
    expect(githubUrl("javascript:alert(1)")).toBeUndefined()
    expect(githubUrl("https://github.com/org/repo/pull/1#discussion_r1")).toBe(
      "https://github.com/org/repo/pull/1#discussion_r1",
    )
  })

  it("survives the payload parser", () => {
    const comments = [
      prPayload(
        thread({
          diffHunk: "@@ -1 +1 @@",
          outdated: true,
          avatar: "https://avatar/alice",
          side: "additions",
          originalLine: 41,
          startLine: 40,
          url: "https://github.com/org/repo/pull/1#discussion_r1",
          replies: [{ author: "bob", body: "ok", avatar: "https://avatar/bob" }],
        }),
      ),
    ]
    expect(parseReview({ version: 1, comments }, formatReviewCommentsMarkdown(comments))?.comments).toEqual(comments)
  })

  it("does not include reply avatars in Markdown", () => {
    const withAvatar = pr({ replies: [{ author: "bob", body: "ok", avatar: "https://avatar/bob" }] })
    const withoutAvatar = pr({ replies: [{ author: "bob", body: "ok" }] })
    expect(formatReviewCommentMarkdown(withAvatar)).toBe(formatReviewCommentMarkdown(withoutAvatar))
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
