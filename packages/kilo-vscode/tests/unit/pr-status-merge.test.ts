/**
 * PR status merging
 *
 * Only the selected worktree fetches review threads, and that GraphQL call can
 * fail. A plain replace would blank the comment list in the open panel, so a
 * status without threads keeps the ones already reported for the same PR.
 */
import { describe, it, expect } from "bun:test"
import { mergePRStatus } from "../../src/agent-manager/pr/am-pr-utils"
import type { PRStatus } from "../../src/agent-manager/types"

function status(overrides: Partial<PRStatus> = {}): PRStatus {
  return {
    number: 42,
    title: "feat: add document inspector",
    url: "https://github.com/org/repo/pull/42",
    state: "open",
    review: null,
    checks: { status: "success", total: 1, passed: 1, failed: 0, pending: 0, checks: [] },
    reviewers: [],
    additions: 1,
    deletions: 0,
    files: 1,
    ...overrides,
  }
}

const threads = {
  total: 2,
  unresolved: 1,
  comments: [
    {
      id: "PRRC_1",
      threadId: "PRRT_1",
      author: "kilo-code-bot",
      body: "guard this",
      resolved: false,
      outdated: false,
    },
  ],
}

describe("mergePRStatus", () => {
  it("keeps the previous threads when a refresh reports none", () => {
    const next = mergePRStatus(status({ comments: threads, unresolvedThreads: 2 }), status({ title: "renamed" }))

    expect(next.title).toBe("renamed")
    expect(next.comments).toEqual(threads)
    expect(next.unresolvedThreads).toBe(2)
  })

  it("prefers the threads reported by the refresh", () => {
    const fresh = { total: 1, unresolved: 0, comments: [] }
    expect(mergePRStatus(status({ comments: threads }), status({ comments: fresh })).comments).toEqual(fresh)
  })

  it.each([{ number: 43 }, { url: "https://github.com/org/other/pull/42" }])(
    "drops another PR's state: %j",
    (change) => {
      const next = mergePRStatus(status({ comments: threads, unresolvedThreads: 2 }), status(change))
      expect(next.comments).toBeUndefined()
      expect(next.unresolvedThreads).toBeUndefined()
    },
  )

  it.each([
    { baseRefOid: "c".repeat(40), headRefOid: "b".repeat(40) },
    { baseRefOid: "a".repeat(40), headRefOid: "c".repeat(40) },
    {},
  ])("drops stale threads but keeps the conversation across revisions: %j", (next) => {
    const conversation = [{ id: "c1", author: "alice", body: "LGTM" }]
    const prev = status({
      baseRefOid: "a".repeat(40),
      headRefOid: "b".repeat(40),
      comments: threads,
      unresolvedThreads: 1,
      conversation,
    })
    const merged = mergePRStatus(prev, status(next))
    expect(merged.comments).toBeUndefined()
    expect(merged.unresolvedThreads).toBeUndefined()
    expect(merged.conversation).toEqual(conversation)
  })

  it("keeps cached previews for same-revision lightweight or failed thread fetches", () => {
    const refs = { baseRefOid: "a".repeat(40), headRefOid: "b".repeat(40) }
    const comments = {
      ...threads,
      comments: [
        {
          ...threads.comments.at(0)!,
          preview: {
            patch: "@@ -1,1 +1,1 @@\n-before\n+after",
            line: 1,
            side: "additions" as const,
            base: refs.baseRefOid,
            head: refs.headRefOid,
            top: false,
            bottom: false,
          },
        },
      ],
    }
    const merged = mergePRStatus(status({ ...refs, comments }), status({ ...refs, unresolvedThreads: 0 }))
    expect(merged.comments).toEqual(comments)
    expect(merged.unresolvedThreads).toBe(0)
  })

  it("passes the first status through untouched", () => {
    expect(mergePRStatus(undefined, status()).comments).toBeUndefined()
  })

  it("accepts a fresh zero count without dropping cached comments", () => {
    const next = mergePRStatus(status({ unresolvedThreads: 1, comments: threads }), status({ unresolvedThreads: 0 }))
    expect(next.unresolvedThreads).toBe(0)
    expect(next.comments).toEqual(threads)
  })

  it("keeps the previous conversation when a refresh reports none", () => {
    const convo = [{ id: "c1", author: "alice", body: "LGTM" }]
    const next = mergePRStatus(status({ conversation: convo }), status({ title: "renamed" }))
    expect(next.conversation).toEqual(convo)
  })
})
