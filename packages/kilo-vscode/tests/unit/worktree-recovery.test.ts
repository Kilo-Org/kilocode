import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ProjectContext } from "../../src/agent-manager/project/context"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"
import { cleanOrphans, restoreWorktree, type RecoveryHost } from "../../src/agent-manager/worktree-recovery"

// Real state manager and real git repository: recovery is only interesting if it agrees with both.
function git(args: string[]) {
  const res = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" })
  if (res.exitCode !== 0) throw new Error(`git failed (${args.join(" ")}): ${Buffer.from(res.stderr).toString("utf8")}`)
}

describe("worktree recovery", () => {
  let root: string
  let target: string
  let state: WorktreeStateManager
  let ctx: ProjectContext
  let calls: string[]
  let host: RecoveryHost

  beforeEach(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "am-recovery-")))
    git(["git", "init", "-b", "main", root])
    git(["git", "-C", root, "config", "user.email", "test@test.com"])
    git(["git", "-C", root, "config", "user.name", "Test"])
    fs.writeFileSync(path.join(root, "README.md"), "init")
    git(["git", "-C", root, "add", "."])
    git(["git", "-C", root, "commit", "-m", "initial"])
    target = path.join(root, ".kilo", "worktrees", "feature")
    fs.mkdirSync(path.dirname(target), { recursive: true })
    git(["git", "-C", root, "worktree", "add", "-b", "feature", target])

    calls = []
    state = new WorktreeStateManager(root, () => undefined)
    ctx = new ProjectContext("project", root, true, { log: () => undefined, state: () => state })
    // Recovery reads the state only if it is already loaded, which is what peekState() means.
    ctx.stateManager()
    host = {
      post: (message) => calls.push(`post:${message.type}`),
      push: () => calls.push("push"),
      log: () => undefined,
      reconcile: async () => {
        calls.push("reconcile")
        return undefined
      },
      refresh: (worktreeId) => calls.push(`refresh:${worktreeId}`),
    }
  })

  afterEach(async () => {
    await state.flush()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("recreates the directory and drops the polling backoff it earned while broken", async () => {
    const id = state.addWorktree({ branch: "feature", path: target, parentBranch: "main" }).id
    git(["git", "-C", root, "worktree", "remove", "--force", target])
    ctx.stale.add(id)

    await restoreWorktree(ctx, host, id)

    expect(fs.existsSync(target)).toBe(true)
    expect(ctx.stale.has(id)).toBe(false)
    // The refresh has to happen: the failures recorded while the directory was gone would otherwise
    // keep the worktree parked for up to the full quarantine window after the user repaired it.
    expect(calls).toEqual(["reconcile", `refresh:${id}`, "push"])
  })

  it("reports a failed restore without clearing anything", async () => {
    const id = state.addWorktree({ branch: "feature", path: target, parentBranch: "main" }).id
    ctx.stale.add(id)

    // The directory is still there, so `worktree add` refuses.
    await restoreWorktree(ctx, host, id)

    expect(ctx.stale.has(id)).toBe(true)
    expect(calls).toEqual(["post:error"])
  })

  it("only deletes directories the last reconcile classified as orphans", async () => {
    const orphan = path.join(root, ".kilo", "worktrees", "leftover")
    fs.mkdirSync(orphan, { recursive: true })
    const unknown = path.join(root, ".kilo", "worktrees", "unlisted")
    fs.mkdirSync(unknown, { recursive: true })
    ctx.report = {
      entries: [],
      orphans: [{ path: orphan, kind: "leftover" }],
      dropped: [],
      pruned: false,
      degraded: false,
    }

    await cleanOrphans(ctx, host, [orphan, unknown])

    expect(fs.existsSync(orphan)).toBe(false)
    expect(fs.existsSync(unknown)).toBe(true)
    expect(calls).toEqual(["reconcile", "push"])
  })

  it("refuses to delete a live worktree even when it is listed as an orphan", async () => {
    ctx.report = {
      entries: [],
      orphans: [{ path: target, kind: "broken" }],
      dropped: [],
      pruned: false,
      degraded: false,
    }

    await cleanOrphans(ctx, host, [target])

    expect(fs.existsSync(target)).toBe(true)
    expect(calls).toEqual(["post:error"])
  })
})
