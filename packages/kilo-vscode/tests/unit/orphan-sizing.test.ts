import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { ProjectContext } from "../../src/agent-manager/project/context"
import {
  disposeOrphanSizes,
  pauseOrphanSizes,
  resumeOrphanSizes,
  trackOrphanSizes,
} from "../../src/agent-manager/orphan-sizing"
import type { OrphanDirectory, WorktreeHealthReport } from "../../src/agent-manager/worktree-reconcile"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

/**
 * `sized` is the production wiring (see project/wiring.ts): the host pushes the new numbers to the
 * webview through it, so a pass that never fires it is a pass the user never sees.
 */
function ctx(sized?: () => void, root = "/repo"): ProjectContext {
  return new ProjectContext("p", root, true, { log: () => undefined, sized })
}

function reportWith(orphans: OrphanDirectory[]): WorktreeHealthReport {
  return { entries: [], orphans, dropped: [], pruned: false, degraded: false }
}

describe("trackOrphanSizes", () => {
  it("does nothing for an empty orphan set", () => {
    let sized = 0
    const project = ctx(() => sized++)
    project.report = reportWith([])

    trackOrphanSizes(project, [], () => undefined)

    expect(sized).toBe(0)
  })

  it("computes sizes for a real directory and mutates them onto the report in place", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-track-"))
    tempDirs.push(dir)
    await fs.writeFile(path.join(dir, "f.txt"), "x".repeat(50))
    const landed = Promise.withResolvers<void>()
    const project = ctx(() => landed.resolve())
    const orphans: OrphanDirectory[] = [{ path: dir, kind: "leftover" }]
    project.report = reportWith(orphans)

    trackOrphanSizes(project, orphans, () => undefined)
    await landed.promise

    expect(project.report?.orphans[0]?.bytes).toBe(50)
    expect(project.report?.orphans[0]?.sized).toBe(true)
  })

  /**
   * The banner waits on every folder having an answer, and `sizes` omits a directory it cannot read
   * rather than failing the whole batch — so an unreadable folder used to leave it calculating forever.
   */
  it("marks a directory it could not measure as settled, with no size", async () => {
    const ok = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-ok-"))
    tempDirs.push(ok)
    await fs.writeFile(path.join(ok, "f.txt"), "x".repeat(15))
    const gone = path.join(os.tmpdir(), "kilo-orphan-never-existed")
    const landed = Promise.withResolvers<void>()
    const project = ctx(() => landed.resolve())
    const orphans: OrphanDirectory[] = [
      { path: ok, kind: "leftover" },
      { path: gone, kind: "leftover" },
    ]
    project.report = reportWith(orphans)

    trackOrphanSizes(project, orphans, () => undefined)
    await landed.promise

    expect(project.report?.orphans[0]?.bytes).toBe(15)
    expect(project.report?.orphans[1]?.bytes, "an unmeasurable folder must not be reported as 0").toBeUndefined()
    expect(
      project.report?.orphans.every((orphan) => orphan.sized),
      "every covered folder settles",
    ).toBe(true)
  })

  /**
   * Every reconcile builds the report's orphan objects from scratch, and the health scheduler
   * reconciles on a timer — so sizes held only as a mutation on those objects vanish on the next poll.
   * The path set is unchanged at that point, so no new pass would run either: the banner showed a size
   * for one poll interval and then said "calculating size…" forever.
   */
  it("re-applies known sizes to the fresh objects a later reconcile builds", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-keep-"))
    tempDirs.push(dir)
    await fs.writeFile(path.join(dir, "f.txt"), "x".repeat(50))
    const landed = Promise.withResolvers<void>()
    let sized = 0
    const project = ctx(() => {
      sized++
      landed.resolve()
    })
    project.report = reportWith([{ path: dir, kind: "leftover" }])

    trackOrphanSizes(project, project.report.orphans, () => undefined)
    await landed.promise
    expect(project.report?.orphans[0]?.bytes).toBe(50)

    // What a routine health poll does: same folders, brand new objects, no sizes on them.
    const fresh: OrphanDirectory[] = [{ path: dir, kind: "leftover" }]
    project.report = reportWith(fresh)
    trackOrphanSizes(project, fresh, () => undefined)

    expect(fresh[0]?.bytes, "a known size must survive the rebuild").toBe(50)
    expect(fresh[0]?.sized).toBe(true)
    await Bun.sleep(20)
    expect(sized, "and it must not need a second walk to get there").toBe(1)
  })

  it("does not re-run when called again with the same orphan path set", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-track-"))
    tempDirs.push(dir)
    await fs.writeFile(path.join(dir, "f.txt"), "x".repeat(10))
    const first = Promise.withResolvers<void>()
    let sized = 0
    const project = ctx(() => {
      sized++
      first.resolve()
    })
    const orphans: OrphanDirectory[] = [{ path: dir, kind: "leftover" }]
    project.report = reportWith(orphans)

    trackOrphanSizes(project, orphans, () => undefined)
    await first.promise
    expect(project.report?.orphans[0]?.bytes).toBe(10)

    // A second call with the identical path set must not kick off a new walk: proven by growing the
    // file and confirming the cached byte count is untouched.
    await fs.appendFile(path.join(dir, "f.txt"), "x".repeat(100))
    trackOrphanSizes(project, orphans, () => undefined)
    await Bun.sleep(20)

    expect(sized).toBe(1)
    expect(project.report?.orphans[0]?.bytes).toBe(10)
  })

  /**
   * A new leftover folder appearing must not re-read the ones already measured — on a real repo that
   * is tens of gigabytes of walking for one added directory.
   */
  it("walks only the folders it has never measured when the set grows", async () => {
    const first = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-grow-a-"))
    const second = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-grow-b-"))
    tempDirs.push(first, second)
    await fs.writeFile(path.join(first, "f.txt"), "x".repeat(11))
    await fs.writeFile(path.join(second, "f.txt"), "x".repeat(22))
    let landed = Promise.withResolvers<void>()
    const project = ctx(() => landed.resolve())
    project.report = reportWith([{ path: first, kind: "leftover" }])

    trackOrphanSizes(project, project.report.orphans, () => undefined)
    await landed.promise

    // The measured folder grows on disk. If the second pass re-walks it, its size changes; if it only
    // walks the newcomer, the cached 11 stands.
    await fs.appendFile(path.join(first, "f.txt"), "x".repeat(500))
    landed = Promise.withResolvers<void>()
    project.report = reportWith([
      { path: first, kind: "leftover" },
      { path: second, kind: "leftover" },
    ])
    trackOrphanSizes(project, project.report.orphans, () => undefined)
    await landed.promise

    expect(project.report?.orphans[0]?.bytes, "an already-measured folder is not re-walked").toBe(11)
    expect(project.report?.orphans[1]?.bytes).toBe(22)
  })

  it("forgets folders that leave the list so the cache cannot grow unbounded", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-forget-"))
    tempDirs.push(dir)
    await fs.writeFile(path.join(dir, "f.txt"), "x".repeat(12))
    let landed = Promise.withResolvers<void>()
    const project = ctx(() => landed.resolve())
    project.report = reportWith([{ path: dir, kind: "leftover" }])

    trackOrphanSizes(project, project.report.orphans, () => undefined)
    await landed.promise
    expect(project.report?.orphans[0]?.bytes).toBe(12)

    // Gone from the list (deleted), then back again with different contents: the stale size must not
    // be resurrected from the cache.
    project.report = reportWith([])
    trackOrphanSizes(project, [], () => undefined)
    await fs.writeFile(path.join(dir, "f.txt"), "x".repeat(90))
    landed = Promise.withResolvers<void>()
    project.report = reportWith([{ path: dir, kind: "leftover" }])
    trackOrphanSizes(project, project.report.orphans, () => undefined)
    await landed.promise

    expect(project.report?.orphans[0]?.bytes).toBe(90)
  })

  it("re-runs once the orphan path set actually changes", async () => {
    const dirA = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-track-a-"))
    const dirB = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-track-b-"))
    tempDirs.push(dirA, dirB)
    await fs.writeFile(path.join(dirB, "f.txt"), "x".repeat(20))
    let landed = Promise.withResolvers<void>()
    const project = ctx(() => landed.resolve())
    project.report = reportWith([{ path: dirA, kind: "leftover" }])

    trackOrphanSizes(project, [{ path: dirA, kind: "leftover" }], () => undefined)
    await landed.promise

    landed = Promise.withResolvers<void>()
    project.report = reportWith([{ path: dirB, kind: "leftover" }])
    trackOrphanSizes(project, [{ path: dirB, kind: "leftover" }], () => undefined)
    await landed.promise

    expect(project.report?.orphans[0]?.bytes).toBe(20)
  })

  it("aborts the pass in flight when the orphan path set changes under it", async () => {
    const dirA = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-abort-a-"))
    const dirB = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-abort-b-"))
    tempDirs.push(dirA, dirB)
    await fs.writeFile(path.join(dirA, "f.txt"), "x".repeat(30))
    await fs.writeFile(path.join(dirB, "f.txt"), "x".repeat(40))
    const landed = Promise.withResolvers<void>()
    let sized = 0
    const project = ctx(() => {
      sized++
      landed.resolve()
    })
    project.report = reportWith([{ path: dirA, kind: "leftover" }])

    trackOrphanSizes(project, [{ path: dirA, kind: "leftover" }], () => undefined)
    // Synchronously superseded: the first walk has not resumed from its first `opendir` yet, so the
    // abort lands before it can read anything.
    project.report = reportWith([{ path: dirB, kind: "leftover" }])
    trackOrphanSizes(project, [{ path: dirB, kind: "leftover" }], () => undefined)
    await landed.promise

    expect(project.report?.orphans[0]?.bytes).toBe(40)
    expect(sized, "the superseded pass must not report").toBe(1)
  })

  it("pauses in-flight sizing for a delete and only measures again once resumed", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-pause-"))
    tempDirs.push(dir)
    await fs.writeFile(path.join(dir, "f.txt"), "x".repeat(70))
    const landed = Promise.withResolvers<void>()
    let sized = 0
    const project = ctx(() => {
      sized++
      landed.resolve()
    })
    const orphans: OrphanDirectory[] = [{ path: dir, kind: "leftover" }]
    project.report = reportWith(orphans)

    trackOrphanSizes(project, orphans, () => undefined)
    pauseOrphanSizes(project)
    await Bun.sleep(20)

    expect(sized, "the paused pass must not land").toBe(0)
    expect(project.report?.orphans[0]?.bytes).toBeUndefined()

    // A reconcile during the delete must not start a new walk over folders being removed.
    trackOrphanSizes(project, orphans, () => undefined)
    await Bun.sleep(20)
    expect(sized).toBe(0)
    expect(project.report?.orphans[0]?.bytes).toBeUndefined()

    // Resuming does not measure by itself; the reconcile that follows the delete does, and it has to
    // actually run even though the surviving path set is the one the paused pass was already given.
    resumeOrphanSizes(project)
    trackOrphanSizes(project, orphans, () => undefined)
    await landed.promise

    expect(project.report?.orphans[0]?.bytes).toBe(70)
  })

  it("resumeOrphanSizes is safe for a project that never started sizing", () => {
    expect(() => resumeOrphanSizes(ctx())).not.toThrow()
  })

  it("aborts in-flight sizing when the project is disposed, without throwing", async () => {
    const project = ctx()
    const orphans: OrphanDirectory[] = [{ path: "/repo/.kilo/worktrees/a", kind: "leftover" }]
    project.report = reportWith(orphans)

    trackOrphanSizes(project, orphans, () => undefined)
    await project.dispose()

    expect(project.lifecycle).toBe("disposed")
  })

  it("disposeOrphanSizes is safe to call for a project that never started sizing", () => {
    expect(() => disposeOrphanSizes(ctx())).not.toThrow()
  })
})
