import { describe, expect, it } from "bun:test"
import { checkFeedback } from "../../webview-ui/agent-manager/pr/pr-check-feedback"
import type { PRCheck } from "../../webview-ui/agent-manager/pr/pr-types"

function feedback(checks: PRCheck[], url = "https://github.com/owner/repo/pull/42", push = false) {
  return checkFeedback(
    {
      number: 42,
      url,
      checks: { status: "failure", total: checks.length, passed: 0, failed: 0, pending: 0, checks },
    },
    "CI feedback",
    push,
  )
}

const failed: PRCheck = {
  name: "Typecheck",
  status: "failure",
  url: "https://github.com/owner/repo/actions/runs/123/job/456",
}

describe("CI check feedback", () => {
  it("sends only failed and cancelled checks with exact lazy log commands", () => {
    const item = feedback([
      failed,
      { name: "Timed out", status: "cancelled" },
      { name: "Passed tests", status: "success" },
      { name: "Running lint", status: "pending" },
      { name: "Skipped deploy", status: "skipped" },
    ])!
    expect(item.origin).toBe("ci")
    expect(item.id).toBe("ci:github.com/owner/repo:42")
    expect(item.body).toContain('"Typecheck": failure')
    expect(item.body).toContain('"Timed out": cancelled')
    expect(item.body).not.toContain("Passed tests")
    expect(item.body).not.toContain("Running lint")
    expect(item.body).not.toContain("Skipped deploy")
    expect(item.body).toContain("gh run view 123 --repo github.com/owner/repo --job 456 --log-failed")
    expect(item.body).toContain('> "$log" 2>&1')
    expect(item.body).toContain("40 lines / 4 KB")
    expect(item.body).toContain("at most 3 excerpts")
  })

  it("keeps publish policy explicit for manual and terminal flows", () => {
    const manual = feedback([failed])!
    expect(manual.body).toContain("Do not commit, push, or rerun the failed workflows")

    const publish = feedback([failed], undefined, true)!
    expect(publish.body).toContain("Do not rerun the failed workflows")
    expect(publish.body).not.toContain("Do not commit, push")
  })

  it("offers no feedback for successful, skipped, pending or empty checks", () => {
    for (const status of ["success", "skipped", "pending"] as const) {
      expect(feedback([{ ...failed, status }])).toBeUndefined()
    }
    expect(feedback([])).toBeUndefined()
  })

  it("supports run-only links and explicit rerun attempts on enterprise hosts", () => {
    const item = feedback(
      [
        { ...failed, url: "https://git.example.com/owner/fork/actions/runs/123/attempts/2/job/789" },
        { ...failed, url: "https://git.example.com/owner/repo/actions/runs/456" },
      ],
      "https://git.example.com/owner/repo/pull/42",
    )!
    expect(item.body).toContain("gh run view 123 --repo git.example.com/owner/fork --attempt 2 --job 789 --log-failed")
    expect(item.body).toContain("gh run view 456 --repo git.example.com/owner/repo --log-failed")
  })

  it("keeps external CI links without inventing GitHub log commands", () => {
    const item = feedback([
      { ...failed, url: "https://ci.example.com/build/123" },
      { ...failed, url: undefined },
    ])!
    expect(item.body).toContain("https://ci.example.com/build/123")
    expect(item.body).toContain("no GitHub Actions log command available")
    expect(item.body).not.toContain("gh run view")
  })

  it.each([
    "javascript:alert(1)",
    "https://user:password@github.com/owner/repo/actions/runs/123/job/456",
    "https://github.com/owner/repo/actions/runs/123/job/456/extra",
    "https://evil.example/owner/repo/actions/runs/123/job/456",
    "https://github.com/owner/repo;touch%20bad/actions/runs/123/job/456",
  ])("does not build commands from unsafe or unsupported links: %s", (url) => {
    const item = feedback([{ ...failed, url }])!
    expect(item.body).not.toContain("gh run view")
    expect(item.body).not.toContain("password")
    expect(item.body).not.toContain("javascript:")
  })

  it("bounds large check sets and names while keeping retrieval instructions", () => {
    const item = feedback(
      Array.from({ length: 200 }, (_, i) => ({
        ...failed,
        name: `${i}: ${"long check name ".repeat(1_000)}`,
      })),
    )!
    expect(item.body.length).toBeLessThan(4_500)
    expect(item.body).toContain("195 more checks omitted")
    expect(item.body).toContain("Inspect the saved check list in small batches")
    expect(item.body).toContain("Never print or attach full logs")
  })

  it("identifies a single failure in a bounded card title", () => {
    expect(feedback([failed])?.title).toBe("CI feedback: Typecheck")
    expect(feedback([{ ...failed, name: "x".repeat(10_000) }])!.title.length).toBeLessThan(256)
    expect(feedback([failed])!.body.length).toBeLessThan(1_500)
  })
})
