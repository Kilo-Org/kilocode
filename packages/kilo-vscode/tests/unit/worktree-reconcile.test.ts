import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { WorktreeManager } from "../../src/agent-manager/WorktreeManager"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"
import { reconcileWorktrees, summarize, unhealthy } from "../../src/agent-manager/worktree-reconcile"

// Real git repositories in temp dirs: the whole point of this module is agreeing with git.
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

function git(args: string[]) {
  const res = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" })
  if (res.exitCode !== 0) {
    throw new Error(`git failed (${args.join(" ")}): ${Buffer.from(res.stderr).toString("utf8")}`)
  }
  return Buffer.from(res.stdout).toString("utf8")
}

async function repo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-health-"))
  tempDirs.push(dir)
  git(["git", "init", "-b", "main", dir])
  git(["git", "-C", dir, "config", "user.email", "test@test.com"])
  git(["git", "-C", dir, "config", "user.name", "Test"])
  await fs.writeFile(path.join(dir, "README.md"), "init")
  git(["git", "-C", dir, "add", "."])
  git(["git", "-C", dir, "commit", "-m", "initial"])
  return dir
}

/** Add a real worktree under `.kilo/worktrees/<name>` on its own branch. */
async function worktree(root: string, name: string): Promise<string> {
  const target = path.join(root, ".kilo", "worktrees", name)
  await fs.mkdir(path.dirname(target), { recursive: true })
  git(["git", "-C", root, "worktree", "add", "-b", name, target])
  return target
}

type Harness = {
  root: string
  manager: WorktreeManager
  state: WorktreeStateManager
  logs: string[]
  run: () => ReturnType<typeof reconcileWorktrees>
}

async function harness(): Promise<Harness> {
  const root = await repo()
  const logs: string[] = []
  const manager = new WorktreeManager(root, (msg) => logs.push(msg))
  const state = new WorktreeStateManager(root, (msg) => logs.push(msg))
  const run = () =>
    reconcileWorktrees({
      root,
      dir: manager.worktreesDir,
      rows: () => state.getWorktrees().map((wt) => ({ id: wt.id, path: wt.path, branch: wt.branch })),
      sessions: (id) => state.getSessions(id).length,
      registered: () => manager.registeredPaths(),
      dirs: () => manager.worktreeDirs(),
      exists: (target) =>
        fs.access(target).then(
          () => true,
          () => false,
        ),
      branchExists: (branch) => manager.branchExists(branch),
      prune: () => manager.pruneWorktrees(),
      drop: (id) => state.removeWorktree(id),
      log: (msg) => logs.push(msg),
    })
  return { root, manager, state, logs, run }
}

describe("reconcileWorktrees", () => {
  it("reports a live worktree as ok and leaves it alone", async () => {
    const h = await harness()
    const dir = await worktree(h.root, "alive")
    h.state.addWorktree({ branch: "alive", path: dir, parentBranch: "main" })

    const report = await h.run()

    expect(report.entries).toHaveLength(1)
    expect(report.entries[0].health).toBe("ok")
    expect(report.dropped).toEqual([])
    expect(report.pruned).toBe(false)
    expect(unhealthy(report).size).toBe(0)
    expect(h.state.getWorktrees()).toHaveLength(1)
  })

  it("keeps a row whose directory is gone but whose branch survives", async () => {
    const h = await harness()
    const dir = await worktree(h.root, "restorable")
    const row = h.state.addWorktree({ branch: "restorable", path: dir, parentBranch: "main" })
    await fs.rm(dir, { recursive: true, force: true })

    const report = await h.run()

    expect(report.entries[0].health).toBe("absent-restorable")
    expect(report.pruned).toBe(true)
    expect(report.dropped).toEqual([])
    expect(h.state.getWorktree(row.id)).toBeTruthy()
    // Pruning is what makes the branch reusable for a later restore.
    expect(git(["git", "-C", h.root, "worktree", "list", "--porcelain"])).not.toContain("restorable")
  })

  it("drops a row only when directory, branch, and sessions are all gone", async () => {
    const h = await harness()
    const dir = await worktree(h.root, "expendable")
    const row = h.state.addWorktree({ branch: "expendable", path: dir, parentBranch: "main" })
    await fs.rm(dir, { recursive: true, force: true })
    git(["git", "-C", h.root, "worktree", "prune"])
    git(["git", "-C", h.root, "branch", "-D", "expendable"])

    const report = await h.run()

    expect(report.entries[0].health).toBe("absent-gone")
    expect(report.dropped).toEqual([row.id])
    expect(h.state.getWorktrees()).toHaveLength(0)
  })

  it("never drops a row that still owns sessions", async () => {
    const h = await harness()
    const dir = await worktree(h.root, "has-history")
    const row = h.state.addWorktree({ branch: "has-history", path: dir, parentBranch: "main" })
    h.state.addSession("ses_1", row.id)
    await fs.rm(dir, { recursive: true, force: true })
    git(["git", "-C", h.root, "worktree", "prune"])
    git(["git", "-C", h.root, "branch", "-D", "has-history"])

    const report = await h.run()

    expect(report.entries[0].health).toBe("absent-gone")
    expect(report.entries[0].sessions).toBe(1)
    expect(report.dropped).toEqual([])
    expect(h.state.getWorktree(row.id)).toBeTruthy()
    expect(h.state.getSession("ses_1")).toBeTruthy()
  })

  it("flags a directory git no longer tracks as unregistered", async () => {
    const h = await harness()
    const dir = await worktree(h.root, "orphaned")
    h.state.addWorktree({ branch: "orphaned", path: dir, parentBranch: "main" })
    // Exactly what a hand-deleted registration looks like: directory intact, metadata gone.
    await fs.rm(path.join(h.root, ".git", "worktrees", "orphaned"), { recursive: true, force: true })

    const report = await h.run()

    expect(report.entries[0].health).toBe("unregistered")
    expect(report.dropped).toEqual([])
    expect(report.orphans).toEqual([])
  })

  it("reports untracked directories as orphans without deleting them", async () => {
    const h = await harness()
    const leftover = path.join(h.manager.worktreesDir, "leftover")
    await fs.mkdir(path.join(leftover, ".kilo-dev"), { recursive: true })
    const broken = path.join(h.manager.worktreesDir, "broken")
    await fs.mkdir(broken, { recursive: true })
    await fs.writeFile(path.join(broken, ".git"), "gitdir: /nowhere\n")

    const report = await h.run()

    expect(report.orphans).toEqual([
      { path: broken, kind: "broken" },
      { path: leftover, kind: "leftover" },
    ])
    // Reported, never removed.
    expect(await fs.readdir(leftover)).toEqual([".kilo-dev"])
    expect(await fs.readdir(broken)).toEqual([".git"])
  })

  it("does not count a live worktree as an orphan", async () => {
    const h = await harness()
    await worktree(h.root, "tracked-by-git-only")

    const report = await h.run()

    expect(report.orphans).toEqual([])
    expect(report.entries).toEqual([])
  })

  it("mutates nothing when git cannot be listed", async () => {
    const h = await harness()
    const dir = await worktree(h.root, "unknown")
    const row = h.state.addWorktree({ branch: "unknown", path: dir, parentBranch: "main" })
    await fs.rm(dir, { recursive: true, force: true })
    let pruned = false

    const report = await reconcileWorktrees({
      root: h.root,
      dir: h.manager.worktreesDir,
      rows: () => h.state.getWorktrees().map((wt) => ({ id: wt.id, path: wt.path, branch: wt.branch })),
      sessions: () => 0,
      registered: async () => undefined,
      dirs: () => h.manager.worktreeDirs(),
      exists: async () => false,
      branchExists: async () => false,
      prune: async () => {
        pruned = true
      },
      drop: () => {
        throw new Error("must not drop rows while health is unknown")
      },
      log: (msg) => h.logs.push(msg),
    })

    expect(report.degraded).toBe(true)
    expect(report.entries[0].health).toBe("unavailable")
    expect(report.dropped).toEqual([])
    expect(pruned).toBe(false)
    expect(h.state.getWorktree(row.id)).toBeTruthy()
  })

  it("resolves rows stored as relative paths", async () => {
    const h = await harness()
    await worktree(h.root, "relative")
    h.state.addWorktree({ branch: "relative", path: ".kilo/worktrees/relative", parentBranch: "main" })

    const report = await h.run()

    expect(report.entries[0].health).toBe("ok")
    expect(report.orphans).toEqual([])
  })

  it("summarizes counts for the log and diagnostics report", async () => {
    const h = await harness()
    const dir = await worktree(h.root, "alive")
    h.state.addWorktree({ branch: "alive", path: dir, parentBranch: "main" })
    await fs.mkdir(path.join(h.manager.worktreesDir, "leftover"), { recursive: true })

    expect(summarize(await h.run())).toBe("ok=1 orphans=1")
  })
})
