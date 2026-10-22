import { describe, expect, it } from "bun:test"
import { seed } from "../../src/agent-manager/pr/am-pr-seed"
import type { SeedHost } from "../../src/agent-manager/pr/am-pr-seed"
import type { Worktree } from "../../src/agent-manager/WorktreeStateManager"

const head = "a".repeat(40)

function worktree(id: string, branch: string): Worktree {
  return { id, branch, path: process.cwd(), parentBranch: "main", createdAt: "2026-09-01T00:00:00Z" }
}

function node(number: number, extra: Record<string, unknown> = {}) {
  return { number, state: "OPEN", isCrossRepository: false, headRefOid: head, title: `PR ${number}`, ...extra }
}

function host(
  reply: (query: string) => unknown,
  tracking = "",
  skip: (id: string) => boolean = () => false,
): SeedHost & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    branch: async (wt) => wt.branch,
    git: async (args) => (args[0] === "rev-parse" ? `${head}\n` : tracking),
    gh: async (args) => {
      calls.push(args)
      const payload = reply(args[3] ?? "")
      if (payload instanceof Error) throw payload
      return JSON.stringify(payload)
    },
    repo: async () => ({ owner: "o", name: "r" }),
    rich: () => true,
    degrade: () => {},
    stale: () => false,
    skip,
    log: () => {},
  }
}

describe("am-pr-seed", () => {
  it("resolves all worktrees with one request and marks branches without a PR as null", async () => {
    const h = host(() => ({
      data: { repository: { defaultBranchRef: { name: "main" }, b0: { nodes: [node(7)] }, b1: { nodes: [] } } },
    }))
    const seeds = await seed([worktree("w1", "feature"), worktree("w2", "fresh")], h)
    expect(h.calls).toHaveLength(1)
    expect(seeds.get("w1")?.number).toBe(7)
    expect(seeds.get("w2")).toBeNull()
  })

  it("leaves a worktree unresolved for a tracking ref, an ambiguous match, or an alias error", async () => {
    const h = host(
      () => ({
        data: {
          repository: {
            b0: { nodes: [] },
            b1: { nodes: [node(1, { headRefOid: "x" }), node(2, { headRefOid: "y" })] },
            b2: { nodes: [] },
          },
        },
        errors: [{ message: "boom", path: ["repository", "b2", "pullRequests"] }],
      }),
      "refs/pull/9/head\n",
    )
    const seeds = await seed([worktree("w1", "imported"), worktree("w2", "dup"), worktree("w3", "broken")], h)
    expect(seeds.size).toBe(0)
  })

  it("returns nothing when the batch request fails so the legacy path runs", async () => {
    const h = host(() => new Error("network"))
    const seeds = await seed([worktree("w1", "feature")], h)
    expect(seeds.size).toBe(0)
  })

  it("skips a worktree whose branch lookup rejects instead of aborting the sync", async () => {
    const h = host(() => ({
      data: { repository: { b0: { nodes: [node(7)] }, b1: { nodes: [] } } },
    }))
    h.branch = async (wt) => {
      if (wt.id === "w0") throw new Error("not a git repository")
      return wt.branch
    }
    const seeds = await seed([worktree("w0", "broken"), worktree("w1", "feature")], h)
    expect(seeds.get("w0")).toBeUndefined()
    expect(seeds.get("w1")?.number).toBe(7)
  })

  it("leaves a parked worktree out of the batch entirely", async () => {
    // A quarantined or broken worktree must cost nothing here: no git process for its head, no place
    // in the query, and above all not the working directory the single gh call runs in.
    const h = host(
      () => ({ data: { repository: { b0: { nodes: [node(7)] } } } }),
      "",
      (id) => id === "parked",
    )
    const dirs: string[] = []
    h.gh = async (args, cwd) => {
      dirs.push(cwd)
      h.calls.push(args)
      return JSON.stringify({ data: { repository: { b0: { nodes: [node(7)] } } } })
    }
    const gits: string[] = []
    h.git = async (args, cwd) => {
      gits.push(cwd)
      return args[0] === "rev-parse" ? `${head}\n` : ""
    }

    const seeds = await seed([{ ...worktree("parked", "broken"), path: "/parked" }, worktree("w1", "feature")], h)

    expect(seeds.get("parked")).toBeUndefined()
    expect(seeds.get("w1")?.number).toBe(7)
    expect(gits).not.toContain("/parked")
    expect(dirs).toEqual([process.cwd()])
  })

  it("does not retry the batch after a timeout, even when the output reads like a refused field", async () => {
    // Retrying spends a second full budget on a command that already proved it does not answer. A
    // killed process can still have flushed partial output, so the timeout has to be tested first —
    // otherwise the field-degrade retry fires on a command that simply never came back.
    const killed = Object.assign(new Error("Unknown JSON field: killed after 10000 ms"), {
      killed: true,
      signal: "SIGTERM",
    })
    const h = host(() => killed)
    const logs: unknown[][] = []
    h.log = (...args) => logs.push(args)
    let degraded = false
    h.degrade = () => {
      degraded = true
    }

    const seeds = await seed([worktree("w1", "feature")], h)

    expect(seeds.size).toBe(0)
    expect(h.calls).toHaveLength(1)
    expect(degraded).toBe(false)
    expect(logs.flat().join(" ")).toContain("Batched PR lookup timed out")
  })

  it("stops resolving worktrees once the generation is superseded", async () => {
    let branches = 0
    const h = host(() => ({ data: { repository: { b0: { nodes: [node(7)] } } } }))
    h.stale = () => branches > 0
    h.branch = async (wt) => {
      branches++
      return wt.branch
    }
    const seeds = await seed([worktree("w0", "a"), worktree("w1", "b")], h)
    expect(branches).toBe(1)
    expect(h.calls).toHaveLength(0)
    expect(seeds.size).toBe(0)
  })
})
