import { describe, expect, it } from "bun:test"
import {
  parsePRResult,
  checkStatus,
  commentsSig,
  formatCheckDuration,
  ghErrorReason,
  parseComments,
  parseReactions,
  parseReviewers,
  signature,
  summarize,
} from "../../src/agent-manager/pr/am-pr-utils"
import { parseTimeline } from "../../src/agent-manager/pr/timeline"
import { isConversationComment } from "../../webview-ui/agent-manager/pr/pr-types"
import type { GhThread, GhReviewRequest, GhReview, GhTimelineItem } from "../../src/agent-manager/pr/am-pr-types"
import type { PRComment, PRConversationComment, PRStatus } from "../../src/agent-manager/types"

// --- parsePRResult ---

describe("comment permissions", () => {
  it.each([
    [true, true, true],
    [true, true, false],
    [true, false, true],
    [false, true, true],
    [undefined, true, true],
    [true, undefined, undefined],
  ])("requires ownership and each GitHub permission (%s, %s, %s)", (owner, update, remove) => {
    const node = {
      id: "comment",
      body: "Body",
      viewerDidAuthor: owner,
      viewerCanUpdate: update,
      viewerCanDelete: remove,
    }
    const expected = { canEdit: owner === true && update === true, canDelete: owner === true && remove === true }
    const thread = parseComments([{ comments: { nodes: [node] }, latest: { nodes: [{ ...node, id: "reply" }] } }]).at(0)
    expect(thread).toMatchObject(expected)
    expect(thread?.replies?.at(0)).toMatchObject({ ...expected, id: "reply" })
    expect(parseTimeline([{ ...node, __typename: "IssueComment" }]).at(0)).toMatchObject({ ...expected, kind: "issue" })
    expect(parseTimeline([{ ...node, __typename: "PullRequestReview" }]).at(0)).toMatchObject({
      kind: "review",
      canEdit: false,
      canDelete: false,
    })
  })
})

describe("parsePRResult", () => {
  it("retains the pull request node ID", () => {
    expect(parsePRResult(JSON.stringify({ number: 1, id: "PR_1" }))?.id).toBe("PR_1")
  })
  it("returns null when number is missing", () => {
    expect(parsePRResult(JSON.stringify({ title: "foo" }))).toBeNull()
  })

  it("parses an open PR", () => {
    const raw = {
      number: 42,
      title: "my PR",
      body: "desc",
      url: "https://github.com/x/y/pull/42",
      state: "OPEN",
      isDraft: false,
      reviewDecision: null,
      additions: 10,
      deletions: 3,
      changedFiles: 2,
    }
    expect(parsePRResult(JSON.stringify(raw))).toEqual({
      number: 42,
      title: "my PR",
      body: "desc",
      url: "https://github.com/x/y/pull/42",
      state: "open",
      review: null,
      additions: 10,
      deletions: 3,
      files: 2,
    })
  })

  it("preserves both immutable PR refs", () => {
    const refs = { baseRefOid: "a".repeat(40), headRefOid: "b".repeat(40) }
    expect(parsePRResult(JSON.stringify({ number: 42, ...refs }))).toMatchObject(refs)
  })

  it("maps isDraft to draft state regardless of gh state field", () => {
    const raw = {
      number: 1,
      title: "",
      body: "",
      url: "",
      state: "OPEN",
      isDraft: true,
      reviewDecision: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }
    expect(parsePRResult(JSON.stringify(raw))?.state).toBe("draft")
  })

  it("maps MERGED state", () => {
    const raw = {
      number: 1,
      title: "",
      body: "",
      url: "",
      state: "MERGED",
      isDraft: false,
      reviewDecision: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }
    expect(parsePRResult(JSON.stringify(raw))?.state).toBe("merged")
  })

  it("maps CLOSED state", () => {
    const raw = {
      number: 1,
      title: "",
      body: "",
      url: "",
      state: "CLOSED",
      isDraft: false,
      reviewDecision: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }
    expect(parsePRResult(JSON.stringify(raw))?.state).toBe("closed")
  })

  it("maps APPROVED review decision", () => {
    const raw = {
      number: 1,
      title: "",
      body: "",
      url: "",
      state: "OPEN",
      isDraft: false,
      reviewDecision: "APPROVED",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }
    expect(parsePRResult(JSON.stringify(raw))?.review).toBe("approved")
  })

  it("maps CHANGES_REQUESTED review decision", () => {
    const raw = {
      number: 1,
      title: "",
      body: "",
      url: "",
      state: "OPEN",
      isDraft: false,
      reviewDecision: "CHANGES_REQUESTED",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }
    expect(parsePRResult(JSON.stringify(raw))?.review).toBe("changes_requested")
  })

  it("maps REVIEW_REQUIRED review decision to pending", () => {
    const raw = {
      number: 1,
      title: "",
      body: "",
      url: "",
      state: "OPEN",
      isDraft: false,
      reviewDecision: "REVIEW_REQUIRED",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }
    expect(parsePRResult(JSON.stringify(raw))?.review).toBe("pending")
  })

  it("parses GitHub mergeability and auto-merge state", () => {
    const result = parsePRResult(
      JSON.stringify({
        number: 1,
        state: "OPEN",
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
        autoMergeRequest: { mergeMethod: "SQUASH" },
      }),
    )
    expect(result?.merge).toEqual({ mergeable: "conflicting", state: "dirty", auto: "squash" })
  })

  it("returns null review for unknown decision", () => {
    const raw = {
      number: 1,
      title: "",
      body: "",
      url: "",
      state: "OPEN",
      isDraft: false,
      reviewDecision: "SOMETHING_ELSE",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }
    expect(parsePRResult(JSON.stringify(raw))?.review).toBeNull()
  })

  it("defaults missing fields to empty strings and zeros", () => {
    const result = parsePRResult(JSON.stringify({ number: 5 }))
    expect(result).toEqual(
      expect.objectContaining({ title: "", body: "", url: "", additions: 0, deletions: 0, files: 0 }),
    )
    expect(result).not.toHaveProperty("checks")
    expect(result).not.toHaveProperty("reviewers")
  })

  it("parses check runs and status contexts from the pull request response", () => {
    const result = parsePRResult(
      JSON.stringify({
        number: 7,
        statusCheckRollup: [
          {
            name: "build",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            detailsUrl: "https://example.com/build",
            startedAt: "2024-01-01T00:00:00Z",
            completedAt: "2024-01-01T00:01:00Z",
          },
          { context: "lint", state: "PENDING", targetUrl: "https://example.com/lint" },
          { name: "tests", conclusion: "FAILURE" },
          { name: "docs", conclusion: "SKIPPED" },
        ],
      }),
    )

    expect(result?.checks).toEqual({
      status: "failure",
      total: 3,
      passed: 1,
      failed: 1,
      pending: 1,
      checks: [
        { name: "build", status: "success", url: "https://example.com/build", duration: "1m 0s" },
        { name: "lint", status: "pending", url: "https://example.com/lint", duration: undefined },
        { name: "tests", status: "failure", url: undefined, duration: undefined },
        { name: "docs", status: "skipped", url: undefined, duration: undefined },
      ],
    })
  })

  it("does not mark cancelled checks as successful", () => {
    const result = parsePRResult(
      JSON.stringify({ number: 10, statusCheckRollup: [{ name: "build", conclusion: "CANCELLED" }] }),
    )
    expect(result?.checks?.status).toBe("failure")
    expect(result?.checks?.failed).toBe(1)
  })

  it("keeps the latest duplicate check run", () => {
    const result = parsePRResult(
      JSON.stringify({
        number: 12,
        statusCheckRollup: [
          { name: "build", conclusion: "FAILURE", startedAt: "2024-01-01T00:00:00Z" },
          { name: "build", conclusion: "SUCCESS", startedAt: "2024-01-01T00:01:00Z" },
        ],
      }),
    )
    expect(result?.checks?.checks).toEqual([{ name: "build", status: "success", url: undefined, duration: undefined }])
  })

  it("prefers a queued rerun without a start time", () => {
    const result = parsePRResult(
      JSON.stringify({
        number: 12,
        statusCheckRollup: [
          { name: "build", conclusion: "SUCCESS", startedAt: "2024-01-01T00:00:00Z" },
          { name: "build", status: "QUEUED" },
        ],
      }),
    )
    expect(result?.checks?.checks).toEqual([{ name: "build", status: "pending", url: undefined, duration: undefined }])
  })

  it("keeps CI running when cancelled checks coexist with pending checks", () => {
    const result = parsePRResult(
      JSON.stringify({
        number: 11,
        statusCheckRollup: [
          { name: "cancelled", conclusion: "CANCELLED" },
          { name: "running", status: "IN_PROGRESS" },
        ],
      }),
    )
    expect(result?.checks?.status).toBe("pending")
    expect(result?.checks?.failed).toBe(1)
    expect(result?.checks?.pending).toBe(1)
  })

  it("preserves reviewer history and ignores dismissed reviews", () => {
    const result = parsePRResult(
      JSON.stringify({
        number: 8,
        reviewRequests: [{ login: "alice", avatarUrl: "https://example.com/alice" }],
        reviews: [
          { author: { login: "bob" }, state: "APPROVED" },
          { author: { login: "bob" }, state: "COMMENTED" },
          { author: { login: "dismissed" }, state: "DISMISSED" },
        ],
      }),
    )

    expect(result?.reviewers).toEqual([
      { login: "alice", avatar: "https://example.com/alice", state: "pending" },
      { login: "bob", avatar: undefined, state: "approved" },
    ])
  })

  it("keeps empty rich fields so legacy follow-up requests are unnecessary", () => {
    const result = parsePRResult(JSON.stringify({ number: 9, statusCheckRollup: [], reviewRequests: [], reviews: [] }))

    expect(result?.checks).toEqual({ status: "none", total: 0, passed: 0, failed: 0, pending: 0, checks: [] })
    expect(result?.reviewers).toEqual([])
  })
})

// --- checkStatus ---

describe("checkStatus", () => {
  it("maps SUCCESS", () => expect(checkStatus("SUCCESS")).toBe("success"))
  it("maps FAILURE", () => expect(checkStatus("FAILURE")).toBe("failure"))
  it("maps ERROR to failure", () => expect(checkStatus("ERROR")).toBe("failure"))
  it("maps PENDING", () => expect(checkStatus("PENDING")).toBe("pending"))
  it("maps QUEUED to pending", () => expect(checkStatus("QUEUED")).toBe("pending"))
  it("maps IN_PROGRESS to pending", () => expect(checkStatus("IN_PROGRESS")).toBe("pending"))
  it("maps REQUESTED to pending", () => expect(checkStatus("REQUESTED")).toBe("pending"))
  it("maps WAITING to pending", () => expect(checkStatus("WAITING")).toBe("pending"))
  it("maps SKIPPED", () => expect(checkStatus("SKIPPED")).toBe("skipped"))
  it("maps CANCELLED", () => expect(checkStatus("CANCELLED")).toBe("cancelled"))
  it("maps TIMED_OUT to failure", () => expect(checkStatus("TIMED_OUT")).toBe("failure"))
  it("maps STALE to cancelled", () => expect(checkStatus("STALE")).toBe("cancelled"))
  it("maps STARTUP_FAILURE to failure", () => expect(checkStatus("STARTUP_FAILURE")).toBe("failure"))
  it("maps unknown state to pending", () => expect(checkStatus("WHATEVER")).toBe("pending"))
  it("is case-insensitive", () => expect(checkStatus("success")).toBe("success"))
})

// --- formatCheckDuration ---

describe("formatCheckDuration", () => {
  it("returns undefined when startedAt is missing", () => {
    expect(formatCheckDuration(undefined, "2024-01-01T00:01:00Z")).toBeUndefined()
  })

  it("returns undefined when completedAt is missing", () => {
    expect(formatCheckDuration("2024-01-01T00:00:00Z", undefined)).toBeUndefined()
  })

  it("returns undefined for invalid timestamps", () => {
    expect(formatCheckDuration("not a date", "2024-01-01T00:01:00Z")).toBeUndefined()
    expect(formatCheckDuration("2024-01-01T00:00:00Z", "not a date")).toBeUndefined()
  })

  it("returns undefined when completedAt is before startedAt", () => {
    expect(formatCheckDuration("2024-01-01T00:01:00Z", "2024-01-01T00:00:00Z")).toBeUndefined()
  })

  it("formats sub-minute durations in seconds", () => {
    expect(formatCheckDuration("2024-01-01T00:00:00Z", "2024-01-01T00:00:45Z")).toBe("45s")
  })

  it("formats durations over a minute as m/s", () => {
    expect(formatCheckDuration("2024-01-01T00:00:00Z", "2024-01-01T00:02:30Z")).toBe("2m 30s")
  })

  it("formats exactly 60 seconds as 1m 0s", () => {
    expect(formatCheckDuration("2024-01-01T00:00:00Z", "2024-01-01T00:01:00Z")).toBe("1m 0s")
  })
})

// --- parseComments ---

describe("parseComments", () => {
  it("returns empty array for empty threads", () => {
    expect(parseComments([])).toEqual([])
  })

  it("skips threads with no comments", () => {
    const threads: GhThread[] = [{ isResolved: false, comments: { nodes: [] } }]
    expect(parseComments(threads)).toHaveLength(0)
  })

  it("parses a resolved thread", () => {
    const threads: GhThread[] = [
      {
        id: "PRT_thread1",
        isResolved: true,
        comments: {
          nodes: [
            {
              id: "c1",
              author: { login: "alice", avatarUrl: "https://avatar" },
              body: "looks good",
              path: "src/foo.ts",
              line: 10,
              url: "https://url",
              createdAt: "2024-01-01T00:00:00Z",
            },
          ],
        },
      },
    ]
    expect(parseComments(threads)).toEqual([
      {
        id: "c1",
        threadId: "PRT_thread1",
        canEdit: false,
        canDelete: false,
        author: "alice",
        avatar: "https://avatar",
        body: "looks good",
        file: "src/foo.ts",
        line: 10,
        url: "https://url",
        resolved: true,
        outdated: false,
        createdAt: new Date("2024-01-01T00:00:00Z").getTime(),
        diffHunk: undefined,
        replies: undefined,
      },
    ])
  })

  it("parses reaction groups and ignores empty or unknown reactions", () => {
    expect(
      parseReactions([
        { content: "HEART", reactors: { totalCount: 3 }, viewerHasReacted: true },
        { content: "THUMBS_UP", users: { totalCount: 0 }, viewerHasReacted: false },
        { content: "NOT_A_REACTION", users: { totalCount: 2 }, viewerHasReacted: false },
      ]),
    ).toEqual([{ content: "HEART", count: 3, viewerHasReacted: true }])
  })

  it("includes reactions on the top-level review comment", () => {
    const result = parseComments([
      {
        id: "thread",
        comments: {
          nodes: [
            {
              id: "comment",
              body: "note",
              reactionGroups: [{ content: "ROCKET", users: { totalCount: 1 }, viewerHasReacted: false }],
            },
          ],
        },
      },
    ])
    expect(result[0]?.reactions).toEqual([{ content: "ROCKET", count: 1, viewerHasReacted: false }])
  })

  it("uses comment id as threadId fallback when thread has no id", () => {
    const threads: GhThread[] = [{ isResolved: false, comments: { nodes: [{ id: "c2", body: "note" }] } }]
    const result = parseComments(threads)
    expect(result[0]?.threadId).toBe("c2")
  })

  it("parses diffHunk when present", () => {
    const threads: GhThread[] = [
      {
        id: "PRT_t1",
        isResolved: false,
        comments: {
          nodes: [{ id: "c3", body: "fix this", diffHunk: "@@ -1,3 +1,4 @@\n context\n+new line" }],
        },
      },
    ]
    expect(parseComments(threads)[0]?.diffHunk).toBe("@@ -1,3 +1,4 @@\n context\n+new line")
  })

  it("defaults missing author to 'unknown'", () => {
    const threads: GhThread[] = [{ isResolved: false, comments: { nodes: [{ id: "c2", body: "note" }] } }]
    expect(parseComments(threads)[0]?.author).toBe("unknown")
  })

  it("keeps later thread comments as replies of the first one", () => {
    const threads: GhThread[] = [
      {
        id: "PRT_t2",
        isResolved: false,
        comments: {
          nodes: [
            { id: "first", body: "first comment", author: { login: "alice" } },
            {
              id: "second",
              body: "second comment",
              author: { login: "bob" },
              createdAt: "2024-01-02T00:00:00Z",
              url: "https://github.com/example/repo/pull/1#discussion_r2",
              reactionGroups: [{ content: "HEART", reactors: { totalCount: 2 }, viewerHasReacted: true }],
            },
          ],
        },
      },
    ]
    const result = parseComments(threads)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe("first")
    expect(result[0]?.replies).toEqual([
      {
        id: "second",
        canEdit: false,
        canDelete: false,
        author: "bob",
        body: "second comment",
        createdAt: new Date("2024-01-02T00:00:00Z").getTime(),
        url: "https://github.com/example/repo/pull/1#discussion_r2",
        reactions: [{ content: "HEART", count: 2, viewerHasReacted: true }],
      },
    ])
  })

  it("marks an outdated thread", () => {
    const threads: GhThread[] = [
      { id: "PRT_t3", isResolved: false, isOutdated: true, comments: { nodes: [{ id: "c4", body: "stale" }] } },
    ]
    expect(parseComments(threads)[0]?.outdated).toBe(true)
  })

  it("falls back to the original line when the thread has no current line", () => {
    const threads: GhThread[] = [
      {
        id: "PRT_t4",
        isResolved: false,
        isOutdated: true,
        comments: { nodes: [{ id: "c5", body: "moved", path: "src/foo.ts", originalLine: 42 }] },
      },
    ]
    expect(parseComments(threads)[0]?.line).toBe(42)
  })

  it("treats nullable GitHub locations as absent instead of emitting null metadata", () => {
    const result = parseComments([
      {
        id: "file-thread",
        path: "src/foo.ts",
        line: null,
        originalLine: null,
        startLine: null,
        diffSide: "RIGHT",
        startDiffSide: "RIGHT",
        comments: { nodes: [{ id: "file-comment", line: null, originalLine: null, body: "File-level note" }] },
      },
    ])[0]
    expect(result?.file).toBe("src/foo.ts")
    expect(result?.line).toBeUndefined()
    expect(result?.originalLine).toBeUndefined()
    expect(result?.startLine).toBeUndefined()
  })

  it("prefers thread location fields and preserves matching multi-line starts", () => {
    const threads: GhThread[] = [
      {
        id: "PRT_left",
        path: "thread-left.ts",
        diffSide: "LEFT",
        line: 12,
        originalLine: 9,
        startLine: 10,
        originalStartLine: 8,
        startDiffSide: "LEFT",
        comments: {
          nodes: [
            {
              id: "left",
              author: { login: "alice", avatarUrl: "https://avatar/alice" },
              body: "old line",
              path: "comment-left.ts",
              line: 4,
              originalLine: 3,
            },
            { id: "left-reply", author: { login: "bob", avatarUrl: "https://avatar/bob" }, body: "reply" },
          ],
        },
      },
      {
        id: "PRT_right",
        path: "thread-right.ts",
        diffSide: "RIGHT",
        line: 20,
        originalLine: 19,
        startLine: 18,
        startDiffSide: "LEFT",
        comments: { nodes: [{ id: "right", body: "new line", path: "comment-right.ts", line: 5 }] },
      },
    ]

    const result = parseComments(threads)
    expect(result[0]).toEqual(
      expect.objectContaining({
        file: "thread-left.ts",
        side: "deletions",
        line: 12,
        originalLine: 9,
        startLine: 10,
        replies: [
          expect.objectContaining({
            id: "left-reply",
            author: "bob",
            body: "reply",
            avatar: "https://avatar/bob",
            canEdit: false,
            canDelete: false,
          }),
        ],
      }),
    )
    expect(result[1]).toEqual(
      expect.objectContaining({
        file: "thread-right.ts",
        side: "additions",
        line: 20,
        originalLine: 19,
      }),
    )
    expect(result[1]).not.toHaveProperty("startLine")
  })
})

describe("PR signature", () => {
  const pr: PRStatus = {
    number: 42,
    url: "https://github.com/x/y/pull/42",
    title: 'A:B "review"',
    body: "C:D\nE",
    state: "open",
    review: null,
    checks: { status: "none", total: 0, passed: 0, failed: 0, pending: 0, checks: [] },
    reviewers: [{ login: "alice", state: "pending" }],
    additions: 1,
    deletions: 0,
    files: 1,
  }

  it("keeps free text and reviewer fields separate in the snapshot", () => {
    expect(signature({ ...pr, reviewers: [{ login: "alice", state: "approved" }] })).not.toBe(signature(pr))
    expect(signature({ ...pr, title: "A:B", body: "C" })).not.toBe(signature({ ...pr, title: "A", body: "B:C" }))
  })

  it("changes when a reviewer avatar becomes available", () => {
    const before = signature(pr)
    expect(signature({ ...pr, reviewers: [{ login: "alice", state: "pending", avatar: "https://avatar" }] })).not.toBe(
      before,
    )
  })

  it("changes when either captured PR ref changes", () => {
    const refs = { baseRefOid: "a".repeat(40), headRefOid: "b".repeat(40) }
    const before = signature({ ...pr, ...refs })
    expect(signature({ ...pr, ...refs, baseRefOid: "c".repeat(40) })).not.toBe(before)
    expect(signature({ ...pr, ...refs, headRefOid: "c".repeat(40) })).not.toBe(before)
  })

  it("deduplicates unchanged PRs and distinguishes unknown and updated thread counts", () => {
    expect(signature(structuredClone(pr))).toBe(signature(pr))
    expect(signature({ ...pr, unresolvedThreads: 0 })).not.toBe(signature(pr))
    expect(signature({ ...pr, unresolvedThreads: 3 })).not.toBe(signature({ ...pr, unresolvedThreads: 0 }))
  })
})

// --- commentsSig ---

describe("commentsSig", () => {
  const thread = (overrides: Partial<PRComment> = {}): PRComment => ({
    id: "c1",
    threadId: "PRRT_1",
    author: "alice",
    body: "looks good",
    resolved: false,
    outdated: false,
    ...overrides,
  })

  it("returns an empty signature when there are no comments", () => {
    expect(commentsSig()).toBe("")
  })

  it("changes when a reply is added, which thread counts alone cannot detect", () => {
    const before = commentsSig([thread()])
    const after = commentsSig([thread({ replies: [{ author: "bob", body: "guard it" }] })])
    expect(after).not.toBe(before)
  })

  it("changes when a body is edited, even when the length stays the same", () => {
    expect(commentsSig([thread({ body: "looks fine" })])).not.toBe(commentsSig([thread()]))
    expect(commentsSig([thread({ replies: [{ author: "bob", body: "guard it" }] })])).not.toBe(
      commentsSig([thread({ replies: [{ author: "bob", body: "guard me" }] })]),
    )
  })

  it("changes when a thread moves line", () => {
    expect(commentsSig([thread({ line: 5 })])).not.toBe(commentsSig([thread()]))
  })

  it("stays stable for unchanged comments", () => {
    expect(commentsSig([thread()])).toBe(commentsSig([thread()]))
  })
})

// --- ghErrorReason ---

describe("ghErrorReason", () => {
  it("keeps the last meaningful line and strips the gh prefix", () => {
    const message = "Command failed: gh api graphql -f query=mutation...\ngh: Resource not accessible by integration"
    expect(ghErrorReason(message)).toBe("Resource not accessible by integration")
  })

  it("falls back to the raw message when there is nothing else", () => {
    expect(ghErrorReason("  boom  ")).toBe("boom")
  })

  it("truncates very long output", () => {
    expect(ghErrorReason("x".repeat(500)).length).toBe(200)
  })
})

// --- parseReviewers ---

describe("parseReviewers", () => {
  it("returns empty array with no requests or reviews", () => {
    expect(parseReviewers([], [])).toEqual([])
  })

  it("adds pending reviewer from request", () => {
    const requests: GhReviewRequest[] = [{ requestedReviewer: { login: "alice", avatarUrl: "https://avatar" } }]
    expect(parseReviewers(requests, [])).toEqual([{ login: "alice", avatar: "https://avatar", state: "pending" }])
  })

  it("skips review requests without a login", () => {
    const requests: GhReviewRequest[] = [{ requestedReviewer: {} }]
    expect(parseReviewers(requests, [])).toHaveLength(0)
  })

  it("adds reviewer from review when not in requests", () => {
    const reviews: GhReview[] = [{ author: { login: "bob" }, state: "APPROVED" }]
    expect(parseReviewers([], reviews)).toEqual([{ login: "bob", avatar: undefined, state: "approved" }])
  })

  it("upgrades pending request to approved when review arrives", () => {
    const requests: GhReviewRequest[] = [{ requestedReviewer: { login: "alice" } }]
    const reviews: GhReview[] = [{ author: { login: "alice" }, state: "APPROVED" }]
    expect(parseReviewers(requests, reviews)).toEqual([{ login: "alice", avatar: undefined, state: "approved" }])
  })

  it("does not downgrade approved to commented", () => {
    const requests: GhReviewRequest[] = [{ requestedReviewer: { login: "alice" } }]
    const reviews: GhReview[] = [
      { author: { login: "alice" }, state: "APPROVED" },
      { author: { login: "alice" }, state: "COMMENTED" },
    ]
    expect(parseReviewers(requests, reviews)[0]?.state).toBe("approved")
  })

  it("does upgrade pending to changes_requested", () => {
    const requests: GhReviewRequest[] = [{ requestedReviewer: { login: "alice" } }]
    const reviews: GhReview[] = [{ author: { login: "alice" }, state: "CHANGES_REQUESTED" }]
    expect(parseReviewers(requests, reviews)[0]?.state).toBe("changes_requested")
  })

  it("skips reviews without a login", () => {
    const reviews: GhReview[] = [{ author: {}, state: "APPROVED" }]
    expect(parseReviewers([], reviews)).toHaveLength(0)
  })
})

// --- parseTimeline ---

describe("parseTimeline", () => {
  const comment = (item: ReturnType<typeof parseTimeline>[number] | undefined) =>
    item && isConversationComment(item) ? item : undefined

  it("parses an empty timeline to an empty array", () => {
    expect(parseTimeline([])).toEqual([])
    expect(parseTimeline([null])).toEqual([])
  })

  it("extracts comments and reviews", () => {
    const nodes: GhTimelineItem[] = [
      {
        __typename: "IssueComment",
        id: "IC_1",
        author: { login: "alice", avatarUrl: "https://avatar/alice" },
        body: "First comment",
        createdAt: "2026-09-01T10:00:00Z",
        url: "https://github.com/org/repo/pull/1#issuecomment-1",
      },
      {
        __typename: "IssueComment",
        id: "IC_empty",
        author: { login: "bob" },
        body: "   ",
      },
      {
        __typename: "PullRequestReview",
        id: "PRR_1",
        author: { login: "bob", avatarUrl: "https://avatar/bob" },
        body: "Consider using rawJSON",
        state: "APPROVED",
        submittedAt: "2026-09-01T11:00:00Z",
        url: "https://github.com/org/repo/pull/1#pullrequestreview-1",
      },
    ]

    const result = parseTimeline(nodes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: "IC_1",
      kind: "issue",
      canEdit: false,
      canDelete: false,
      author: "alice",
      avatar: "https://avatar/alice",
      body: "First comment",
      createdAt: new Date("2026-09-01T10:00:00Z").getTime(),
      url: "https://github.com/org/repo/pull/1#issuecomment-1",
      isBot: undefined,
    })
    expect(result[1]).toEqual({
      id: "PRR_1",
      kind: "review",
      canEdit: false,
      canDelete: false,
      author: "bob",
      avatar: "https://avatar/bob",
      body: "Consider using rawJSON",
      createdAt: new Date("2026-09-01T11:00:00Z").getTime(),
      url: "https://github.com/org/repo/pull/1#pullrequestreview-1",
      state: "approved",
      isBot: undefined,
    })
  })

  it("keeps a review without text so an approval is still visible", () => {
    const result = parseTimeline([
      {
        __typename: "PullRequestReview",
        id: "PRR_approve",
        author: { login: "alice" },
        state: "APPROVED",
        submittedAt: "2026-09-01T11:00:00Z",
      },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: "review", body: "", state: "approved", author: "alice" })
  })

  it("drops a review without text or a known state", () => {
    expect(parseTimeline([{ __typename: "PullRequestReview", id: "PRR_x", author: { login: "alice" } }])).toEqual([])
  })

  it("parses commits with author, short SHA, and message", () => {
    const result = parseTimeline([
      {
        __typename: "PullRequestCommit",
        id: "PRC_1",
        commit: {
          oid: "a".repeat(40),
          abbreviatedOid: "aaaaaaa",
          messageHeadline: "Handle reconnect",
          committedDate: "2026-09-01T12:00:00Z",
          url: "https://github.com/org/repo/commit/aaaaaaa",
          author: { user: { login: "marius", avatarUrl: "https://avatar/marius" }, name: "Marius" },
        },
      },
    ])
    expect(result).toEqual([
      {
        kind: "commit",
        id: "PRC_1",
        sha: "a".repeat(40),
        short: "aaaaaaa",
        message: "Handle reconnect",
        author: "marius",
        avatar: "https://avatar/marius",
        createdAt: new Date("2026-09-01T12:00:00Z").getTime(),
        url: "https://github.com/org/repo/commit/aaaaaaa",
      },
    ])
  })

  it("falls back to the git author name when no user is linked", () => {
    const result = parseTimeline([
      { __typename: "PullRequestCommit", id: "PRC_2", commit: { oid: "b".repeat(40), author: { name: "CI Bot" } } },
    ])
    expect(result[0]).toMatchObject({ kind: "commit", author: "CI Bot", short: "bbbbbbb" })
  })

  it("parses lifecycle events with actor and detail", () => {
    const result = parseTimeline([
      {
        __typename: "MergedEvent",
        id: "ME_1",
        actor: { login: "alice" },
        createdAt: "2026-09-01T13:00:00Z",
        mergeRefName: "main",
      },
      {
        __typename: "HeadRefForcePushedEvent",
        id: "FP_1",
        actor: { login: "marius" },
        createdAt: "2026-09-01T14:00:00Z",
        beforeCommit: { abbreviatedOid: "aaaaaaa" },
        afterCommit: { abbreviatedOid: "bbbbbbb" },
      },
      { __typename: "ClosedEvent", id: "CE_1", actor: { login: "bob" }, createdAt: "2026-09-01T15:00:00Z" },
      { __typename: "ReopenedEvent", id: "RE_1", actor: { login: "bob" }, createdAt: "2026-09-01T16:00:00Z" },
    ])
    expect(result.map((item) => (item.kind === "event" ? [item.event, item.detail] : []))).toEqual([
      ["merged", "main"],
      ["force_pushed", "aaaaaaa to bbbbbbb"],
      ["closed", undefined],
      ["reopened", undefined],
    ])
  })

  it("sorts comments, reviews, commits, and events chronologically", () => {
    const result = parseTimeline([
      {
        __typename: "PullRequestCommit",
        id: "PRC_late",
        commit: { oid: "c".repeat(40), committedDate: "2026-09-01T12:00:00Z" },
      },
      {
        __typename: "IssueComment",
        id: "IC_early",
        author: { login: "alice" },
        body: "First",
        createdAt: "2026-09-01T08:00:00Z",
      },
      {
        __typename: "PullRequestReview",
        id: "PRR_mid",
        author: { login: "bob" },
        body: "Review",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-09-01T10:00:00Z",
      },
    ])
    expect(result.map((item) => item.id)).toEqual(["IC_early", "PRR_mid", "PRC_late"])
  })

  it("identifies bot accounts", () => {
    const result = parseTimeline([
      {
        __typename: "IssueComment",
        id: "IC_bot1",
        author: { login: "kilo-code-bot", __typename: "Bot" },
        body: "Review summary",
      },
      { __typename: "IssueComment", id: "IC_bot2", author: { login: "dependabot[bot]" }, body: "Bump dependency" },
      {
        __typename: "IssueComment",
        id: "IC_user",
        author: { login: "alice", __typename: "User" },
        body: "User comment",
      },
    ])
    expect(comment(result.find((item) => item.id === "IC_bot1"))?.isBot).toBe(true)
    expect(comment(result.find((item) => item.id === "IC_bot2"))?.isBot).toBe(true)
    expect(comment(result.find((item) => item.id === "IC_user"))?.isBot).toBeUndefined()
  })

  it("ignores timeline item types the conversation does not render", () => {
    expect(parseTimeline([{ __typename: "LabeledEvent", id: "LE_1" }])).toEqual([])
  })
})

// --- signature with conversation ---

describe("signature with conversation", () => {
  const item = (overrides: Partial<PRConversationComment> = {}): PRConversationComment => ({
    id: "c1",
    author: "alice",
    body: "looks good",
    ...overrides,
  })

  it("updates PR status signature when conversation changes", () => {
    const base: PRStatus = {
      number: 1,
      title: "PR",
      url: "https://example.com/pr/1",
      state: "open",
      review: null,
      checks: { status: "none", total: 0, passed: 0, failed: 0, pending: 0, checks: [] },
      reviewers: [],
      additions: 0,
      deletions: 0,
      files: 0,
    }

    const withoutConvo = signature(base)
    const withConvo = signature({ ...base, conversation: [item()] })
    const updatedConvo = signature({ ...base, conversation: [item({ body: "updated" })] })

    expect(withConvo).not.toBe(withoutConvo)
    expect(updatedConvo).not.toBe(withConvo)
  })

  it("updates check links and failures even when aggregate counts stay the same", () => {
    const base: PRStatus = {
      number: 1,
      title: "PR",
      url: "https://example.com/pr/1",
      state: "open",
      review: null,
      checks: summarize([
        { name: "Lint", status: "failure", url: "https://example.com/job/1" },
        { name: "Tests", status: "success" },
      ]),
      reviewers: [],
      additions: 0,
      deletions: 0,
      files: 0,
    }
    const rerun = {
      ...base,
      checks: summarize([
        { name: "Lint", status: "failure", url: "https://example.com/job/2" },
        { name: "Tests", status: "success" },
      ]),
    }
    const swapped = {
      ...base,
      checks: summarize([
        { name: "Lint", status: "success", url: "https://example.com/job/1" },
        { name: "Tests", status: "failure" },
      ]),
    }
    expect(signature(rerun)).not.toBe(signature(base))
    expect(signature(swapped)).not.toBe(signature(base))
    expect(signature(structuredClone(base))).toBe(signature(base))
  })
})
