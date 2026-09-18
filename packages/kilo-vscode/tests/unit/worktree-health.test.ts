import { describe, expect, it } from "bun:test"
import { HealthScheduler, applyPresence, healthPayload, needsReconcile } from "../../src/agent-manager/worktree-health"
import { formatLog } from "../../src/agent-manager/log-format"
import type { WorktreeHealthReport } from "../../src/agent-manager/worktree-reconcile"

function report(overrides: Partial<WorktreeHealthReport> = {}): WorktreeHealthReport {
  return { entries: [], orphans: [], dropped: [], pruned: false, degraded: false, ...overrides }
}

describe("healthPayload", () => {
  it("sends only unhealthy worktrees plus the orphan directories and their kind", () => {
    const payload = healthPayload(
      report({
        entries: [
          { id: "a", path: "/a", branch: "a", health: "ok", sessions: 0 },
          { id: "b", path: "/b", branch: "b", health: "absent-restorable", sessions: 1 },
        ],
        orphans: [
          { path: "/o", kind: "leftover" },
          { path: "/b", kind: "broken" },
        ],
      }),
      [{ id: "a" }, { id: "b" }],
    )

    // Paths, not a count: the confirmation dialog has to name what it would delete. The kind travels
    // with them because only a `leftover` is safe to describe as untracked by git.
    expect(payload).toEqual({
      worktreeHealth: { b: "absent-restorable" },
      orphanDirectories: [
        { path: "/o", kind: "leftover" },
        { path: "/b", kind: "broken" },
      ],
    })
  })

  it("drops worktrees that are no longer in state", () => {
    const payload = healthPayload(
      report({ entries: [{ id: "gone", path: "/g", branch: "g", health: "unregistered", sessions: 0 }] }),
      [],
    )

    expect(payload).toEqual({ worktreeHealth: {}, orphanDirectories: [] })
  })

  it("sends nothing before the first reconcile", () => {
    expect(healthPayload(undefined, [{ id: "a" }])).toEqual({})
  })

  // `bytes` is filled in asynchronously by orphans/sizing.ts, mutated onto the same orphan objects
  // this function reads — it must ride along without healthPayload needing to know sizing exists.
  it("carries the orphan byte size through once a size pass has landed", () => {
    const payload = healthPayload(
      report({
        orphans: [
          { path: "/o", kind: "leftover", bytes: 1024 },
          { path: "/b", kind: "broken" },
        ],
      }),
      [],
    )

    expect(payload.orphanDirectories).toEqual([
      { path: "/o", kind: "leftover", bytes: 1024 },
      { path: "/b", kind: "broken" },
    ])
  })
})

describe("applyPresence", () => {
  it("tracks newly missing worktrees and syncs branches", () => {
    const stale = new Set<string>()
    const branches: string[] = []

    const applied = applyPresence(
      {
        worktrees: [
          { worktreeId: "a", missing: false, branch: "main" },
          { worktreeId: "b", missing: true },
        ],
        degraded: false,
      },
      stale,
      [{ id: "a" }, { id: "b" }],
      (id, branch) => {
        branches.push(`${id}:${branch}`)
        return true
      },
    )

    expect(applied).toEqual({ staleChanged: true, branchChanged: true, degraded: false })
    expect([...stale]).toEqual(["b"])
    expect(branches).toEqual(["a:main"])
  })

  it("reports no change when the stale set is unchanged", () => {
    const stale = new Set(["b"])

    const applied = applyPresence(
      { worktrees: [{ worktreeId: "b", missing: true }], degraded: false },
      stale,
      [{ id: "b" }],
      () => false,
    )

    expect(applied.staleChanged).toBe(false)
    expect([...stale]).toEqual(["b"])
  })

  // "Could not check" must never be confused with "checked, and it is fine".
  it("leaves the stale set alone when the probe is degraded", () => {
    const stale = new Set(["b"])

    const applied = applyPresence({ worktrees: [], degraded: true }, stale, [{ id: "b" }], () => false)

    expect(applied).toEqual({ staleChanged: false, branchChanged: false, degraded: true })
    expect([...stale]).toEqual(["b"])
  })

  it("forgets worktrees that left state entirely", () => {
    const stale = new Set(["removed"])

    applyPresence({ worktrees: [], degraded: false }, stale, [{ id: "kept" }], () => false)

    expect([...stale]).toEqual([])
  })

  // updateWorktreeBranch returns true only when it changed a row, so `some` would stop at the first
  // drifted worktree and leave every later one on its old branch.
  it("syncs every drifted branch, not just the first", () => {
    const branches: string[] = []

    const applied = applyPresence(
      {
        worktrees: [
          { worktreeId: "a", missing: false, branch: "one" },
          { worktreeId: "b", missing: false, branch: "two" },
          { worktreeId: "c", missing: false, branch: "three" },
        ],
        degraded: false,
      },
      new Set<string>(),
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      (id, branch) => {
        branches.push(`${id}:${branch}`)
        return true
      },
    )

    expect(branches).toEqual(["a:one", "b:two", "c:three"])
    expect(applied.branchChanged).toBe(true)
  })

  it("reports no branch change when nothing drifted", () => {
    const applied = applyPresence(
      { worktrees: [{ worktreeId: "a", missing: false, branch: "one" }], degraded: false },
      new Set<string>(),
      [{ id: "a" }],
      () => false,
    )

    expect(applied.branchChanged).toBe(false)
  })
})

describe("needsReconcile", () => {
  it("asks for a reconcile when the stale set changed", () => {
    expect(needsReconcile({ staleChanged: true }, report())).toBe(true)
  })

  // A degraded report learned nothing; this probe answered, so git can be asked again.
  it("retries a degraded report even when nothing changed", () => {
    expect(needsReconcile({ staleChanged: false }, report({ degraded: true }))).toBe(true)
  })

  it("stays quiet on a healthy, unchanged probe", () => {
    expect(needsReconcile({ staleChanged: false }, report())).toBe(false)
    expect(needsReconcile({ staleChanged: false }, undefined)).toBe(false)
  })
})

describe("HealthScheduler", () => {
  it("coalesces repeated requests into one run", async () => {
    const runs: string[] = []
    const scheduler = new HealthScheduler<{ id: string }>(async (target) => {
      runs.push(target.id)
    }, 5)

    scheduler.schedule({ id: "p1" })
    scheduler.schedule({ id: "p1" })
    scheduler.schedule({ id: "p1" })
    await Bun.sleep(30)

    expect(runs).toEqual(["p1"])
  })

  it("keeps projects independent", async () => {
    const runs: string[] = []
    const scheduler = new HealthScheduler<{ id: string }>(async (target) => {
      runs.push(target.id)
    }, 5)

    scheduler.schedule({ id: "p1" })
    scheduler.schedule({ id: "p2" })
    await Bun.sleep(30)

    expect(runs.sort()).toEqual(["p1", "p2"])
  })

  it("does not schedule while a run is in flight", async () => {
    const runs: string[] = []
    const scheduler = new HealthScheduler<{ id: string }>(async (target) => {
      runs.push(target.id)
      await Bun.sleep(20)
    }, 5)

    scheduler.schedule({ id: "p1" })
    await Bun.sleep(10)
    scheduler.schedule({ id: "p1" })
    await Bun.sleep(40)

    expect(runs).toEqual(["p1"])
  })

  it("drops pending work on dispose", async () => {
    const runs: string[] = []
    const scheduler = new HealthScheduler<{ id: string }>(async (target) => {
      runs.push(target.id)
    }, 10)

    scheduler.schedule({ id: "p1" })
    scheduler.dispose()
    await Bun.sleep(30)

    expect(runs).toEqual([])
  })
})

describe("formatLog", () => {
  // `Agent Manager request recovery failed: {}` — the reason a real failure logged as nothing.
  it("keeps the stack of an Error instead of stringifying it to {}", () => {
    const line = formatLog(["boom:", new Error("kaboom")])

    expect(JSON.stringify(new Error("kaboom"))).toBe("{}")
    expect(line).toContain("boom:")
    expect(line).toContain("Error: kaboom")
    expect(line).toContain("worktree-health.test")
  })

  it("renders objects readably and strings verbatim", () => {
    expect(formatLog(["count", { files: 2 }])).toBe("count { files: 2 }")
  })
})
