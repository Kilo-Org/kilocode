import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { trackOrphanSizes } from "../../src/agent-manager/orphans/sizing"
import { ProjectContext } from "../../src/agent-manager/project/context"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"
import { cleanOrphans, restoreWorktree, type RecoveryHost } from "../../src/agent-manager/worktree-recovery"
import type { OrphanDirectory } from "../../src/agent-manager/worktree-reconcile"

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
  /** Reassigned per test; stands in for the host push that carries new sizes to the webview. */
  let onSized: () => void

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
    onSized = () => undefined
    ctx = new ProjectContext("project", root, true, {
      log: () => undefined,
      state: () => state,
      sized: () => onSized(),
    })
    // Recovery reads the state only if it is already loaded, which is what peekState() means.
    ctx.stateManager()
    host = {
      post: (message) => calls.push(`post:${message.type}`),
      push: () => calls.push("push"),
      log: () => undefined,
      // Mirrors real usage: `host.reconcile` returns the current `ctx.report`, which the tests set
      // up before calling `cleanOrphans` — the "fresh" reconcile agrees with the stale one unless a
      // test deliberately swaps `ctx.report` out from under it to exercise revalidation.
      reconcile: async () => {
        calls.push("reconcile")
        return ctx.report
      },
      refresh: (worktreeId) => calls.push(`refresh:${worktreeId}`),
      reveal: (path) => calls.push(`reveal:${path}`),
      teardown: async (_root, path) => {
        calls.push(`teardown:${path}`)
      },
      removeSnapshot: async (_root, path) => {
        calls.push(`removeSnapshot:${path}`)
        return true
      },
      withProgress: async (title, task) => {
        calls.push(`progress:${title}`)
        return task(() => false)
      },
      notifyResult: (kind) => calls.push(`notify:${kind}`),
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
    // Deletion runs behind a progress notification, teardown before the directory is staged,
    // removeSnapshot after, then a second reconcile + push so the banner recomputes.
    expect(calls).toEqual([
      "progress:Removing leftover worktree folders",
      "reconcile",
      `teardown:${orphan}`,
      `removeSnapshot:${orphan}`,
      "reconcile",
      "push",
      // One of the two requested paths was not a known orphan (the fresh reconcile never listed
      // it), so the completion notification reports a partial result even though nothing failed.
      "notify:warning",
    ])
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
    expect(calls).toEqual([
      "progress:Removing leftover worktree folders",
      "reconcile",
      `teardown:${target}`,
      "post:error",
      // Reconciles even though nothing was removed: the size pass was paused for the delete, and this
      // is what resumes measuring whatever is still on disk.
      "reconcile",
      "notify:error",
    ])
  })

  it("re-validates against a fresh reconcile, not the possibly-stale ctx.report", async () => {
    const orphan = path.join(root, ".kilo", "worktrees", "leftover")
    fs.mkdirSync(orphan, { recursive: true })
    // ctx.report (built before the dialog was shown) still lists it, but the fresh reconcile the
    // host returns from inside cleanOrphans no longer does — e.g. the pool just claimed it.
    ctx.report = {
      entries: [],
      orphans: [{ path: orphan, kind: "leftover" }],
      dropped: [],
      pruned: false,
      degraded: false,
    }
    host.reconcile = async () => {
      calls.push("reconcile")
      return { entries: [], orphans: [], dropped: [], pruned: false, degraded: false }
    }

    await cleanOrphans(ctx, host, [orphan])

    expect(fs.existsSync(orphan)).toBe(true)
    expect(calls).toEqual(["progress:Removing leftover worktree folders", "reconcile", "reconcile", "notify:error"])
  })

  it("cancels the size pass when a delete starts, then measures only what survived", async () => {
    const doomed = path.join(root, ".kilo", "worktrees", "doomed")
    const survivor = path.join(root, ".kilo", "worktrees", "survivor")
    fs.mkdirSync(doomed, { recursive: true })
    fs.mkdirSync(survivor, { recursive: true })
    fs.writeFileSync(path.join(doomed, "f.txt"), "x".repeat(100))
    fs.writeFileSync(path.join(survivor, "f.txt"), "x".repeat(25))
    const orphans: OrphanDirectory[] = [
      { path: doomed, kind: "leftover" },
      { path: survivor, kind: "leftover" },
    ]
    ctx.report = { entries: [], orphans, dropped: [], pruned: false, degraded: false }

    // Mirrors production, where every reconcile re-runs sizing for the orphans it just listed and the
    // context's `sized` hook pushes the numbers to the webview.
    const landed = Promise.withResolvers<void>()
    let sized = 0
    onSized = () => {
      sized++
      landed.resolve()
    }
    host.reconcile = async () => {
      calls.push("reconcile")
      const live = (ctx.report?.orphans ?? []).filter((orphan) => fs.existsSync(orphan.path))
      ctx.report = { entries: [], orphans: live, dropped: [], pruned: false, degraded: false }
      trackOrphanSizes(ctx, live, () => undefined)
      return ctx.report
    }

    // A walk is already in flight over both folders when the user confirms the delete.
    trackOrphanSizes(ctx, orphans, () => undefined)

    await cleanOrphans(ctx, host, [doomed])
    await landed.promise

    expect(fs.existsSync(doomed)).toBe(false)
    expect(fs.existsSync(survivor)).toBe(true)
    // Exactly one pass reports: the one after the delete. The pass that was walking the folder the
    // user deleted is cancelled on the way in, and the reconcile inside the delete does not start a
    // replacement for the doomed set either.
    expect(sized).toBe(1)
    // The leftover that is still there gets measured once the delete is done.
    expect(ctx.report?.orphans.map((orphan) => orphan.path)).toEqual([survivor])
    expect(ctx.report?.orphans[0]?.bytes).toBe(25)
  })

  it("stages the directory (rename) instead of a blocking recursive delete", async () => {
    const orphan = path.join(root, ".kilo", "worktrees", "leftover")
    fs.mkdirSync(path.join(orphan, "nested"), { recursive: true })
    ctx.report = {
      entries: [],
      orphans: [{ path: orphan, kind: "leftover" }],
      dropped: [],
      pruned: false,
      degraded: false,
    }

    await cleanOrphans(ctx, host, [orphan])

    expect(fs.existsSync(orphan)).toBe(false)
    // Nothing named .kilo-delete-* should survive once the background reap this awaits internally
    // (via detachOrphanDirectory's `done`) has had a chance to run.
    await ctx.worktreeManager().settle()
    const leftovers = fs.readdirSync(path.dirname(orphan)).filter((name) => name.startsWith(".kilo-delete-"))
    expect(leftovers).toEqual([])
  })
})
