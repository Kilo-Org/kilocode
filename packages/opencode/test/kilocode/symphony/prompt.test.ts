import { describe, it, expect } from "bun:test"
import { renderPrompt } from "@/devilcode/symphony/agent/prompt"
import type { TrackerIssue } from "@/devilcode/symphony/tracker/types"

const mockIssue: TrackerIssue = {
  id: "id1",
  identifier: "TEST-1",
  title: "Fix bug",
  description: "desc",
  priority: 1,
  state: "Todo",
  branchName: "test-1",
  url: "https://linear.app",
  labels: [],
  blockedBy: [],
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
}

describe("renderPrompt", () => {
  it("renders a simple variable", () => {
    const result = renderPrompt("Attempt {{ attempt }}", { issue: mockIssue, attempt: 3 })
    expect(result).toBe("Attempt 3")
  })

  it("renders nested variables via dot-path", () => {
    const result = renderPrompt(
      "Issue {{ issue.identifier }}: {{ issue.title }}",
      { issue: mockIssue, attempt: 1 },
    )
    expect(result).toBe("Issue TEST-1: Fix bug")
  })

  it("renders null attempt as empty string", () => {
    const result = renderPrompt("Attempt: {{ attempt }}", { issue: mockIssue, attempt: null })
    expect(result).toBe("Attempt: ")
  })

  it("throws on unknown variable reference", () => {
    expect(() =>
      renderPrompt("{{ unknown }}", { issue: mockIssue, attempt: 1 }),
    ).toThrow("SymphonyConfigError")
  })

  it("handles multiple variables in one template", () => {
    const result = renderPrompt(
      "{{ issue.identifier }} - {{ issue.title }} (attempt {{ attempt }})",
      { issue: mockIssue, attempt: 2 },
    )
    expect(result).toBe("TEST-1 - Fix bug (attempt 2)")
  })

  it("preserves non-template text", () => {
    const result = renderPrompt(
      "No variables here, just plain text.",
      { issue: mockIssue, attempt: 1 },
    )
    expect(result).toBe("No variables here, just plain text.")
  })
})
