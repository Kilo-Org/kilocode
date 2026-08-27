import { describe, expect, it } from "bun:test"
import {
  reviewComments,
  reviewKey,
  reviewOpen,
  pruneReviewState,
  setReviewComments,
  setReviewOpen,
} from "../../webview-ui/agent-manager/project/review-state"

describe("project review state", () => {
  it("keeps identical contexts separate by project", () => {
    let open = setReviewOpen({}, "a", "local", true)
    open = setReviewOpen(open, "b", "local", false)
    let comments = setReviewComments({}, "a", "local", [{ file: "a.ts" } as never])
    comments = setReviewComments(comments, "b", "local", [])

    expect(reviewKey("a", "local")).not.toBe(reviewKey("b", "local"))
    expect(reviewOpen(open, "a", "local")).toBe(true)
    expect(reviewOpen(open, "b", "local")).toBe(false)
    expect(reviewComments(comments, "a", "local")).toHaveLength(1)
    expect(reviewComments(comments, "b", "local")).toHaveLength(0)
  })

  it("prunes removed worktree contexts for one project only", () => {
    const values = { "a:wt-1": true, "a:wt-2": true, "b:wt-2": true }

    expect(pruneReviewState(values, "a", new Set(["wt-1"]))).toEqual({ "a:wt-1": true, "b:wt-2": true })
  })
})
