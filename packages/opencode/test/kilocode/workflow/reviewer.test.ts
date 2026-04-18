import { describe, expect, test } from "bun:test"
import { routeFix, triageFindings } from "@/devilcode/workflow/reviewer"
import type { ReviewFinding } from "@/devilcode/workflow/types"
import type { TeamConfig } from "@/devilcode/team/config"

const teamConfig: TeamConfig = {
  enabled: true,
  roles: {
    orchestrator: {
      displayName: "O",
      provider: "a",
      model: "m",
      effort: "max",
      tier: 1,
      canDelegate: ["senior", "worker"],
      maxConcurrent: 1,
      capabilities: [],
    },
    senior: {
      displayName: "S",
      provider: "b",
      model: "n",
      effort: "xhigh",
      tier: 2,
      canDelegate: ["worker"],
      maxConcurrent: 2,
      capabilities: [],
    },
    worker: {
      displayName: "W",
      provider: "c",
      model: "o",
      effort: "default",
      tier: 3,
      canDelegate: [],
      maxConcurrent: 5,
      capabilities: [],
    },
  },
  routing: { strategy: "hierarchical", defaultRole: "worker", escalationEnabled: true },
}

describe("routeFix", () => {
  test("routes security findings to senior", () => {
    const f: ReviewFinding = { id: "R-01", severity: "blocker", category: "security", file: "a.ts", description: "bad" }
    expect(routeFix(f, teamConfig)).toBe("senior")
  })
  test("routes architecture findings to senior", () => {
    const f: ReviewFinding = { id: "R-02", severity: "warning", category: "architecture", file: "a.ts", description: "x" }
    expect(routeFix(f, teamConfig)).toBe("senior")
  })
  test("routes correctness blockers to senior", () => {
    const f: ReviewFinding = { id: "R-03", severity: "blocker", category: "correctness", file: "a.ts", description: "x" }
    expect(routeFix(f, teamConfig)).toBe("senior")
  })
  test("routes style issues to worker", () => {
    const f: ReviewFinding = { id: "R-04", severity: "suggestion", category: "style", file: "a.ts", description: "x" }
    expect(routeFix(f, teamConfig)).toBe("worker")
  })
  test("routes type-safety issues to worker", () => {
    const f: ReviewFinding = { id: "R-05", severity: "warning", category: "type-safety", file: "a.ts", description: "x" }
    expect(routeFix(f, teamConfig)).toBe("worker")
  })
  test("honors suggestedRole when valid", () => {
    const f: ReviewFinding = {
      id: "R-06",
      severity: "blocker",
      category: "performance",
      file: "a.ts",
      description: "x",
      suggestedRole: "senior",
    }
    expect(routeFix(f, teamConfig)).toBe("senior")
  })
  test("ignores invalid suggestedRole", () => {
    const f: ReviewFinding = {
      id: "R-07",
      severity: "suggestion",
      category: "style",
      file: "a.ts",
      description: "x",
      suggestedRole: "nonexistent",
    }
    expect(routeFix(f, teamConfig)).toBe("worker")
  })
})

// devilcode_change - audit MA2: routeFix must not assume "senior" exists.
describe("routeFix without senior role", () => {
  const noSeniorConfig: TeamConfig = {
    enabled: true,
    roles: {
      lead: {
        displayName: "Lead",
        provider: "a",
        model: "m",
        effort: "high",
        tier: 2,
        canDelegate: ["builder"],
        maxConcurrent: 1,
        capabilities: [],
      },
      builder: {
        displayName: "Builder",
        provider: "a",
        model: "m",
        effort: "default",
        tier: 1,
        canDelegate: [],
        maxConcurrent: 3,
        capabilities: [],
      },
    },
    routing: {
      strategy: "hierarchical",
      defaultRole: "builder",
      escalationEnabled: true,
      reviewEscalationRole: "lead",
    },
  }

  test("uses configured reviewEscalationRole for security", () => {
    const f: ReviewFinding = { id: "R-S1", severity: "blocker", category: "security", file: "a.ts", description: "x" }
    expect(routeFix(f, noSeniorConfig)).toBe("lead")
  })

  test("uses configured reviewEscalationRole for correctness blockers", () => {
    const f: ReviewFinding = { id: "R-S2", severity: "blocker", category: "correctness", file: "a.ts", description: "x" }
    expect(routeFix(f, noSeniorConfig)).toBe("lead")
  })

  test("falls back to defaultRole when no senior and no reviewEscalationRole", () => {
    const cfg: TeamConfig = {
      ...noSeniorConfig,
      routing: { strategy: "hierarchical", defaultRole: "builder", escalationEnabled: true },
    }
    const f: ReviewFinding = { id: "R-S3", severity: "blocker", category: "architecture", file: "a.ts", description: "x" }
    expect(routeFix(f, cfg)).toBe("builder")
  })
})

describe("triageFindings", () => {
  test("separates blockers from non-blockers", () => {
    const findings: ReviewFinding[] = [
      { id: "R-01", severity: "blocker", category: "security", file: "a.ts", description: "x" },
      { id: "R-02", severity: "warning", category: "style", file: "b.ts", description: "x" },
      { id: "R-03", severity: "suggestion", category: "performance", file: "c.ts", description: "x" },
      { id: "R-04", severity: "blocker", category: "correctness", file: "d.ts", description: "x" },
    ]
    const { blockers, warnings, suggestions } = triageFindings(findings)
    expect(blockers.length).toBe(2)
    expect(warnings.length).toBe(1)
    expect(suggestions.length).toBe(1)
  })
  test("returns empty arrays for no findings", () => {
    const { blockers, warnings, suggestions } = triageFindings([])
    expect(blockers).toEqual([])
    expect(warnings).toEqual([])
    expect(suggestions).toEqual([])
  })
})
