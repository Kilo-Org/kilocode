import { describe, expect, it } from "bun:test"
import {
  parsePRResult,
  checkStatus,
  commentsSig,
  formatCheckDuration,
  ghErrorReason,
  parseComments,
  parseReviewers,
} from "../../src/agent-manager/pr/am-pr-utils"
import type { GhThread, GhReviewRequest, GhReview } from "../../src/agent-manager/pr/am-pr-types"
import type { PRComment } from "../../src/agent-manager/types"

// --- parsePRResult ---

describe("parsePRResult", () => {
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
  it("maps TIMED_OUT to cancelled", () => expect(checkStatus("TIMED_OUT")).toBe("cancelled"))
  it("maps STALE to cancelled", () => expect(checkStatus("STALE")).toBe("cancelled"))
  it("maps STARTUP_FAILURE to cancelled", () => expect(checkStatus("STARTUP_FAILURE")).toBe("cancelled"))
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
            { id: "second", body: "second comment", author: { login: "bob" } },
          ],
        },
      },
    ]
    const result = parseComments(threads)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe("first")
    expect(result[0]?.replies).toEqual([{ author: "bob", body: "second comment" }])
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
