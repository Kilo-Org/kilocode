import { describe, expect, test } from "bun:test"
import { approvers, evaluate } from "./approval-policy"

const engineers = new Set(["engineer"])

describe("approval policy", () => {
  test("requires engineering approval", () => {
    expect(evaluate([], engineers, "author").ok).toBe(false)
    expect(evaluate([{ user: "outsider", state: "APPROVED" }], engineers, "author").ok).toBe(false)
    expect(evaluate([{ user: "Engineer", state: "APPROVED" }], engineers, "author")).toEqual({
      ok: true,
      reason: "Approved by engineering team member @engineer",
    })
  })

  test("does not count self approval", () => {
    expect(evaluate([{ user: "engineer", state: "APPROVED" }], engineers, "ENGINEER").ok).toBe(false)
  })

  test("uses the latest opinionated review", () => {
    expect(
      approvers([
        { user: "engineer", state: "APPROVED" },
        { user: "engineer", state: "COMMENTED" },
        { user: "engineer", state: "CHANGES_REQUESTED" },
      ]).has("engineer"),
    ).toBe(false)
  })

  test("retains approval after a comment-only review", () => {
    expect(
      approvers([
        { user: "engineer", state: "APPROVED" },
        { user: "engineer", state: "COMMENTED" },
      ]).has("engineer"),
    ).toBe(true)
  })

  test("does not count a dismissed approval", () => {
    expect(
      approvers([
        { user: "engineer", state: "APPROVED" },
        { user: "engineer", state: "DISMISSED" },
      ]).has("engineer"),
    ).toBe(false)
  })
})
