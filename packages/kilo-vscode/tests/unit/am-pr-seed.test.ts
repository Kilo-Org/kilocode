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

function host(reply: (query: string) => unknown, tracking = ""): SeedHost & { calls: string[][] } {
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
