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
    const next = mergePRStatus(status({ comments: threads }), status({ title: "renamed" }))

    expect(next.title).toBe("renamed")
    expect(next.comments).toEqual(threads)
  })

  it("prefers the threads reported by the refresh", () => {
    const fresh = { total: 1, unresolved: 0, comments: [] }
    expect(mergePRStatus(status({ comments: threads }), status({ comments: fresh })).comments).toEqual(fresh)
  })

  it("drops threads that belong to another pull request", () => {
    expect(mergePRStatus(status({ comments: threads }), status({ number: 43 })).comments).toBeUndefined()
  })

  it("passes the first status through untouched", () => {
    expect(mergePRStatus(undefined, status()).comments).toBeUndefined()
  })
})
