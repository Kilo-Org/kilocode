import { describe, expect, it } from "bun:test"
import { diagnostics, probeTool } from "../../src/agent-manager/worktree-diagnostics"
import { runDoctor } from "../../src/agent-manager/worktree-doctor"
import type { WorktreeHealthReport } from "../../src/agent-manager/worktree-reconcile"

function report(overrides: Partial<WorktreeHealthReport> = {}): WorktreeHealthReport {
  return { entries: [], orphans: [], dropped: [], pruned: false, degraded: false, ...overrides }
}

const probes = [
  { name: "git" as const, version: "git version 2.51.0", ms: 12 },
  { name: "gh" as const, version: "gh version 2.88.0", ms: 30 },
]

describe("diagnostics", () => {
  it("reports tools, counts, and every worktree with its reason", () => {
    const text = diagnostics({
      root: "/repo",
      worktreesDir: "/repo/.kilo/worktrees",
      probes,
      report: report({
        entries: [
          { id: "a", path: "/repo/.kilo/worktrees/a", branch: "alive", health: "ok", sessions: 1 },
          { id: "b", path: "/repo/.kilo/worktrees/b", branch: "gone-dir", health: "absent-restorable", sessions: 2 },
          { id: "c", path: "/repo/.kilo/worktrees/c", branch: "broken", health: "unregistered", sessions: 0 },
        ],
        orphans: [{ path: "/repo/.kilo/worktrees/leftover", kind: "leftover" }],
        pruned: true,
        dropped: ["d"],
      }),
      quarantined: ["c"],
      labels: new Map([["a", "Alive row"]]),
    })

    expect(text).toContain("git: git version 2.51.0 (12ms, budget 5000ms)")
    expect(text).toContain("gh: gh version 2.88.0 (30ms, budget 10000ms)")
    expect(text).toContain("  ok: 1")
    expect(text).toContain("  absent-restorable: 1")
    expect(text).toContain("  unregistered: 1")
    expect(text).toContain("  orphan directories: 1")
    expect(text).toContain("  quarantined: 1")
    expect(text).toContain("  pruned this pass: true")
    expect(text).toContain("  state entries dropped: 1")
    // Row labels match what the UI shows, so a report can be matched to a row.
    expect(text).toContain("[ok] Alive row — /repo/.kilo/worktrees/a (sessions=1)")
    expect(text).toContain("[unregistered] broken — /repo/.kilo/worktrees/c (sessions=0 quarantined)")
    expect(text).toContain("[leftover] /repo/.kilo/worktrees/leftover")
  })

  it("counts a worktree parked by both pollers once", () => {
    // The PR loop and the stats loop park worktrees independently, and the same broken worktree is
    // usually parked by both. The report is about worktrees, not about loops.
    const text = diagnostics({
      root: "/repo",
      worktreesDir: "/repo/.kilo/worktrees",
      probes,
      report: report({
        entries: [{ id: "a", path: "/repo/.kilo/worktrees/a", branch: "stuck", health: "ok", sessions: 0 }],
      }),
      quarantined: [...new Set(["a", "a"])],
      labels: new Map(),
    })

    expect(text).toContain("  quarantined: 1")
    expect(text).toContain("[ok] stuck — /repo/.kilo/worktrees/a (sessions=0 quarantined)")
  })

  it("says plainly when a failed tool is the reason everything looks broken", () => {
    const text = diagnostics({
      root: "/repo",
      worktreesDir: "/repo/.kilo/worktrees",
      probes: [{ name: "git", ms: 5000, error: "spawn git ENOENT" }],
      report: report({
        entries: [{ id: "a", path: "/a", branch: "x", health: "unavailable", sessions: 0 }],
        degraded: true,
      }),
      quarantined: [],
      labels: new Map(),
    })

    expect(text).toContain("git: FAILED — spawn git ENOENT")
    expect(text).toContain("NOTE: git could not list worktrees, so nothing was classified or repaired.")
    expect(text).toContain("  unavailable: 1")
  })

  it("does not pretend to know health before the first reconcile", () => {
    const text = diagnostics({
      root: "/repo",
      worktreesDir: "/repo/.kilo/worktrees",
      probes,
      report: undefined,
      quarantined: [],
      labels: new Map(),
    })

    expect(text).toContain("health has not been determined yet")
  })
})

describe("probeTool", () => {
  it("keeps the first version line and the elapsed time", async () => {
    let now = 100
    const probe = await probeTool(
      "git",
      async () => "git version 2.51.0\nextra",
      () => (now += 7),
    )

    expect(probe).toEqual({ name: "git", version: "git version 2.51.0", ms: 7 })
  })

  it("records the failure instead of throwing", async () => {
    const probe = await probeTool(
      "gh",
      async () => {
        throw new Error("spawn gh ENOENT")
      },
      () => 0,
    )

    expect(probe.version).toBeUndefined()
    expect(probe.error).toBe("spawn gh ENOENT")
  })
})

describe("runDoctor", () => {
  it("writes the report to the output channel and reveals it", async () => {
    const lines: string[] = []
    let revealed = 0

    await runDoctor(undefined, {
      reconcile: async () => undefined,
      quarantined: () => [],
      out: {
        appendLine: (text) => lines.push(text),
        show: () => {
          revealed++
        },
      },
      log: () => undefined,
    })

    // A command that reveals nothing looks like a command that did nothing.
    expect(lines).toEqual(["Kilo Agent Manager — no project is open."])
    expect(revealed).toBe(1)
  })

  it("still writes the report when the channel cannot be revealed", async () => {
    const lines: string[] = []

    await runDoctor(undefined, {
      reconcile: async () => undefined,
      quarantined: () => [],
      out: { appendLine: (text) => lines.push(text) },
      log: () => undefined,
    })

    expect(lines).toHaveLength(1)
  })
})
