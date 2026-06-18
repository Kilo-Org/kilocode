import { describe, expect, test } from "bun:test"
import { approvers, evaluate, type Review } from "./approval-policy"

const engineers = new Set(["engineer"])
const head = "current"
const review = (user: string, state: string, commit = head): Review => ({ user, state, commit })

describe("approval policy", () => {
  test("requires engineering approval", () => {
    expect(evaluate([], engineers, "author", head).ok).toBe(false)
    expect(evaluate([review("outsider", "APPROVED")], engineers, "author", head).ok).toBe(false)
    expect(evaluate([review("Engineer", "APPROVED")], engineers, "author", head)).toEqual({
      ok: true,
      reason: "Approved by engineering team member @engineer",
    })
  })

  test("does not count self approval", () => {
    expect(evaluate([review("engineer", "APPROVED")], engineers, "ENGINEER", head).ok).toBe(false)
  })

  test("does not count approval for an older commit", () => {
    expect(evaluate([review("engineer", "APPROVED", "old")], engineers, "author", head).ok).toBe(false)
  })

  test("uses the latest opinionated review", () => {
    expect(
      approvers(
        [review("engineer", "APPROVED"), review("engineer", "COMMENTED"), review("engineer", "CHANGES_REQUESTED")],
        head,
      ).has("engineer"),
    ).toBe(false)
  })

  test("retains approval after a comment-only review", () => {
    expect(approvers([review("engineer", "APPROVED"), review("engineer", "COMMENTED")], head).has("engineer")).toBe(
      true,
    )
  })

  test("does not count a dismissed approval", () => {
    expect(approvers([review("engineer", "APPROVED"), review("engineer", "DISMISSED")], head).has("engineer")).toBe(
      false,
    )
  })
})
