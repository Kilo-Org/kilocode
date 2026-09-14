import { describe, expect, it } from "bun:test"
import { Quarantine } from "../../src/agent-manager/quarantine"
import { PRStatusPoller } from "../../src/agent-manager/PRStatusPoller"
import {
  QUARANTINE_BASE,
  QUARANTINE_THRESHOLD,
  isTimeout,
  quarantineWindow,
} from "../../src/agent-manager/command-budget"

describe("Quarantine", () => {
  it("tolerates isolated failures", () => {
    const q = new Quarantine()

    for (let i = 0; i < QUARANTINE_THRESHOLD - 1; i++) expect(q.fail("wt1")).toBe(false)

    expect(q.blocked("wt1")).toBe(false)
  })

  it("blocks a worktree after repeated failures", () => {
    let now = 1_000
    const q = new Quarantine(() => now)

    for (let i = 0; i < QUARANTINE_THRESHOLD; i++) q.fail("wt1")

    expect(q.blocked("wt1")).toBe(true)
    now += QUARANTINE_BASE - 1
    expect(q.blocked("wt1")).toBe(true)
    now += 2
    // Window elapsed: exactly one attempt is allowed through.
    expect(q.blocked("wt1")).toBe(false)
  })

  it("keeps other worktrees unaffected", () => {
    const q = new Quarantine()

    for (let i = 0; i < QUARANTINE_THRESHOLD + 2; i++) q.fail("broken")

    expect(q.blocked("broken")).toBe(true)
    expect(q.blocked("healthy")).toBe(false)
  })

  it("forgets history after a success", () => {
    let now = 0
    const q = new Quarantine(() => now)
    for (let i = 0; i < QUARANTINE_THRESHOLD; i++) q.fail("wt1")

    q.clear("wt1")

    expect(q.blocked("wt1")).toBe(false)
    expect(q.failures("wt1")).toBe(0)
  })

  it("widens the window as failures pile up, up to the cap", () => {
    expect(quarantineWindow(QUARANTINE_THRESHOLD)).toBe(QUARANTINE_BASE)
    expect(quarantineWindow(QUARANTINE_THRESHOLD + 1)).toBe(QUARANTINE_BASE * 2)
    expect(quarantineWindow(QUARANTINE_THRESHOLD + 50)).toBe(30 * 60_000)
  })

  it("drops worktrees that no longer exist", () => {
    const q = new Quarantine()
    for (let i = 0; i < QUARANTINE_THRESHOLD; i++) q.fail("gone")

    q.retain(new Set(["kept"]))

    expect(q.failures("gone")).toBe(0)
  })
})

describe("isTimeout", () => {
  it("recognizes a killed child process", () => {
    const err = Object.assign(new Error("Command failed: gh pr view"), { killed: true, signal: "SIGTERM" })

    expect(isTimeout(err)).toBe(true)
  })

  it("recognizes an explicit timeout message", () => {
    expect(isTimeout(new Error("Git command timed out after 15000ms"))).toBe(true)
    expect(isTimeout("git command timed out")).toBe(true)
  })

  it("does not mistake ordinary failures for timeouts", () => {
    expect(isTimeout(new Error("Command failed: gh pr view\nno pull requests found"))).toBe(false)
    expect(isTimeout(Object.assign(new Error("boom"), { killed: false, signal: null }))).toBe(false)
    expect(isTimeout(undefined)).toBe(false)
  })
})

describe("PRStatusPoller failure isolation", () => {
  type Internal = {
    fetchOne: (id: string) => Promise<void>
    fetchAll: () => Promise<void>
    gh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
    target: (id: string) => unknown
    quarantine: Quarantine
    failures: number
  }

  const killed = () => Object.assign(new Error("Command failed: gh pr view"), { killed: true, signal: "SIGTERM" })

  function poller(onStatus: (id: string, error?: string) => void) {
    const worktrees = [
      { id: "broken", path: process.cwd(), branch: "broken", parentBranch: "main", createdAt: "" },
      { id: "healthy", path: process.cwd(), branch: "healthy", parentBranch: "main", createdAt: "" },
    ]
    const instance = new PRStatusPoller({
      getWorktrees: () => worktrees as never,
      getWorkspaceRoot: () => process.cwd(),
      onStatus: (id, _pr, error) => onStatus(id, error),
      log: () => undefined,
    })
    return { instance, internal: instance as unknown as Internal }
  }

  it("stops polling a worktree that keeps failing and leaves others alone", async () => {
    const seen: string[] = []
    const { instance, internal } = poller((id, error) => seen.push(`${id}:${error ?? "ok"}`))
    internal.gh = async () => {
      throw new Error("offline")
    }

    for (let i = 0; i < QUARANTINE_THRESHOLD; i++) {
      await internal.fetchOne("broken").catch(() => undefined)
    }
    const attempts = seen.length
    // Quarantined: no further work is attempted for this worktree.
    await internal.fetchOne("broken")

    expect(attempts).toBeGreaterThan(0)
    expect(seen.length).toBe(attempts)
    expect(internal.target("broken")).toBeUndefined()
    expect(internal.target("healthy")).toBeDefined()
    instance.stop()
  })

  it("lets an explicit refresh override a quarantine", () => {
    const { instance, internal } = poller(() => undefined)
    for (let i = 0; i < QUARANTINE_THRESHOLD; i++) internal.quarantine.fail("broken")
    expect(internal.target("broken")).toBeUndefined()

    instance.refresh("broken")

    expect(internal.quarantine.failures("broken")).toBe(0)
    expect(internal.target("broken")).toBeDefined()
    instance.stop()
  })

  it("skips worktrees the health reconcile marked unhealthy", () => {
    const instance = new PRStatusPoller({
      getWorktrees: () =>
        [{ id: "unregistered", path: process.cwd(), branch: "x", parentBranch: "main", createdAt: "" }] as never,
      getWorkspaceRoot: () => process.cwd(),
      onStatus: () => undefined,
      isUnhealthy: (id) => id === "unregistered",
      log: () => undefined,
    })

    expect((instance as unknown as Internal).target("unregistered")).toBeUndefined()
    instance.stop()
  })

  // A hanging gh has established nothing about the PR. Reporting "no PR" would clear the quarantine
  // and render a wedged lookup as a clean, PR-less worktree.
  it("reports a timed-out strategy ladder as a failure, not as no PR", async () => {
    const seen: string[] = []
    const { instance, internal } = poller((id, error) => seen.push(`${id}:${error ?? "none"}`))
    internal.gh = async () => {
      throw killed()
    }

    await internal.fetchOne("broken").catch(() => undefined)

    expect(seen).toEqual(["broken:fetch_failed"])
    expect(internal.quarantine.failures("broken")).toBe(1)
    instance.stop()
  })

  it("still reports a genuinely absent PR as no PR", async () => {
    const seen: string[] = []
    const { instance, internal } = poller((id, error) => seen.push(`${id}:${error ?? "none"}`))
    internal.gh = async () => {
      throw new Error("no pull requests found for branch")
    }

    await internal.fetchOne("broken")

    expect(seen).toEqual(["broken:none"])
    expect(internal.quarantine.failures("broken")).toBe(0)
    instance.stop()
  })

  // Comparing the rejection total against the quarantined total let one long-parked worktree cancel
  // out a healthy one that just started failing, so the loop-level backoff never engaged.
  it("counts a fresh failure even while another worktree is quarantined", async () => {
    const { instance, internal } = poller(() => undefined)
    for (let i = 0; i < QUARANTINE_THRESHOLD; i++) internal.quarantine.fail("broken")
    internal.gh = async (args) => {
      if (args.includes("--version")) return { stdout: "gh version 2.0.0", stderr: "" }
      throw killed()
    }

    await internal.fetchAll()

    expect(internal.failures).toBe(1)
    instance.stop()
  })
})
