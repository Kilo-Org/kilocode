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

function ctx(root = "/repo"): ProjectContext {
  return new ProjectContext("p", root, true, { log: () => undefined })
}

function reportWith(orphans: OrphanDirectory[]): WorktreeHealthReport {
  return { entries: [], orphans, dropped: [], pruned: false, degraded: false }
}

describe("trackOrphanSizes", () => {
  it("does nothing for an empty orphan set", () => {
    const project = ctx()
    project.report = reportWith([])
    let sized = 0

    trackOrphanSizes(
      project,
      [],
      () => undefined,
      () => sized++,
    )

    expect(sized).toBe(0)
  })

  it("computes sizes for a real directory and mutates them onto the report in place", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-track-"))
    tempDirs.push(dir)
    await fs.writeFile(path.join(dir, "f.txt"), "x".repeat(50))
    const project = ctx()
    const orphans: OrphanDirectory[] = [{ path: dir, kind: "leftover" }]
    project.report = reportWith(orphans)

    const landed = Promise.withResolvers<void>()
    trackOrphanSizes(
      project,
      orphans,
      () => undefined,
      () => landed.resolve(),
    )
    await landed.promise

    expect(project.report?.orphans[0]?.bytes).toBe(50)
  })

  it("does not re-run when called again with the same orphan path set", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-track-"))
    tempDirs.push(dir)
    await fs.writeFile(path.join(dir, "f.txt"), "x".repeat(10))
    const project = ctx()
    const orphans: OrphanDirectory[] = [{ path: dir, kind: "leftover" }]
    project.report = reportWith(orphans)

    const first = Promise.withResolvers<void>()
    trackOrphanSizes(
      project,
      orphans,
      () => undefined,
      () => first.resolve(),
    )
    await first.promise
    expect(project.report?.orphans[0]?.bytes).toBe(10)

    // A second call with the identical path set must not kick off a new walk: proven by growing the
    // file and confirming the cached byte count is untouched.
    await fs.appendFile(path.join(dir, "f.txt"), "x".repeat(100))
    let resized = false
    trackOrphanSizes(
      project,
      orphans,
      () => undefined,
      () => (resized = true),
    )
    await Bun.sleep(20)

    expect(resized).toBe(false)
    expect(project.report?.orphans[0]?.bytes).toBe(10)
  })

  it("re-runs once the orphan path set actually changes", async () => {
    const dirA = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-track-a-"))
    const dirB = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-track-b-"))
    tempDirs.push(dirA, dirB)
    await fs.writeFile(path.join(dirB, "f.txt"), "x".repeat(20))
    const project = ctx()
    project.report = reportWith([{ path: dirA, kind: "leftover" }])

    const first = Promise.withResolvers<void>()
    trackOrphanSizes(
      project,
      [{ path: dirA, kind: "leftover" }],
      () => undefined,
      () => first.resolve(),
    )
    await first.promise

    project.report = reportWith([{ path: dirB, kind: "leftover" }])
    const second = Promise.withResolvers<void>()
    trackOrphanSizes(
      project,
      [{ path: dirB, kind: "leftover" }],
      () => undefined,
      () => second.resolve(),
    )
    await second.promise

    expect(project.report?.orphans[0]?.bytes).toBe(20)
  })

  it("aborts the pass in flight when the orphan path set changes under it", async () => {
    const dirA = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-abort-a-"))
    const dirB = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-abort-b-"))
    tempDirs.push(dirA, dirB)
    await fs.writeFile(path.join(dirA, "f.txt"), "x".repeat(30))
    await fs.writeFile(path.join(dirB, "f.txt"), "x".repeat(40))
    const project = ctx()
    project.report = reportWith([{ path: dirA, kind: "leftover" }])

    let firstSized = 0
    trackOrphanSizes(
      project,
      [{ path: dirA, kind: "leftover" }],
      () => undefined,
      () => firstSized++,
    )
    // Synchronously superseded: the first walk has not resumed from its first `opendir` yet, so the
    // abort lands before it can read anything.
    project.report = reportWith([{ path: dirB, kind: "leftover" }])
    const second = Promise.withResolvers<void>()
    trackOrphanSizes(
      project,
      [{ path: dirB, kind: "leftover" }],
      () => undefined,
      () => second.resolve(),
    )
    await second.promise

    expect(project.report?.orphans[0]?.bytes).toBe(40)
    expect(firstSized, "the superseded pass must not report").toBe(0)
  })

  it("pauses in-flight sizing for a delete and only measures again once resumed", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-pause-"))
    tempDirs.push(dir)
    await fs.writeFile(path.join(dir, "f.txt"), "x".repeat(70))
    const project = ctx()
    const orphans: OrphanDirectory[] = [{ path: dir, kind: "leftover" }]
    project.report = reportWith(orphans)

    let sized = 0
    trackOrphanSizes(
      project,
      orphans,
      () => undefined,
      () => sized++,
    )
    pauseOrphanSizes(project)
    await Bun.sleep(20)

    expect(sized, "the paused pass must not land").toBe(0)
    expect(project.report?.orphans[0]?.bytes).toBeUndefined()

    // A reconcile during the delete must not start a new walk over folders being removed.
    trackOrphanSizes(
      project,
      orphans,
      () => undefined,
      () => sized++,
    )
    await Bun.sleep(20)
    expect(sized).toBe(0)
    expect(project.report?.orphans[0]?.bytes).toBeUndefined()

    // Resuming does not measure by itself; the reconcile that follows the delete does, and it has to
    // actually run even though the surviving path set is the one the paused pass was already given.
    resumeOrphanSizes(project)
    const landed = Promise.withResolvers<void>()
    trackOrphanSizes(
      project,
      orphans,
      () => undefined,
      () => landed.resolve(),
    )
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
