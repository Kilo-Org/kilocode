import { describe, it, expect } from "bun:test"
import { RunScriptManager, type RunHandle, type RunStatus } from "../../src/agent-manager/run/manager"

function createManager() {
  const logs: string[] = []
  const statuses: RunStatus[] = []
  const manager = new RunScriptManager(
    (msg) => logs.push(msg),
    (status) => statuses.push({ ...status }),
    () => new Date("2026-01-02T03:04:05.000Z"),
  )
  return { manager, logs, statuses }
}

function deferred<T>() {
  const out = {} as { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
  out.promise = new Promise<T>((resolve, reject) => {
    out.resolve = resolve
    out.reject = reject
  })
  return out
}

describe("RunScriptManager", () => {
  it("transitions from idle to running and back to idle on finish", async () => {
    const ctx = createManager()
    const handle: RunHandle = { stop: () => {} }

    expect(await ctx.manager.start("wt-1", async () => handle)).toBe(true)
    ctx.manager.finish("wt-1", { exitCode: 0 })

    expect(ctx.statuses.map((s) => s.state)).toEqual(["running", "idle"])
    expect(ctx.manager.status("wt-1")).toMatchObject({ worktreeId: "wt-1", state: "idle", exitCode: 0 })
  })

  it("rejects duplicate starts while a run is active", async () => {
    const ctx = createManager()
    const first = await ctx.manager.start("wt-1", async () => ({ stop: () => {} }))
    const second = await ctx.manager.start("wt-1", async () => ({ stop: () => {} }))

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(ctx.statuses.map((s) => s.state)).toEqual(["running"])
  })

  it("marks a running task as stopping and invokes the handle", async () => {
    const ctx = createManager()
    let stopped = 0
    await ctx.manager.start("wt-1", async () => ({ stop: () => stopped++ }))

    ctx.manager.stop("wt-1")
    ctx.manager.stop("wt-1")

    expect(stopped).toBe(1)
    expect(ctx.manager.status("wt-1").state).toBe("stopping")
    expect(ctx.statuses.map((s) => s.state)).toEqual(["running", "stopping"])
  })

  it("stops the handle when a stop request races task startup", async () => {
    const ctx = createManager()
    const gate = deferred<RunHandle>()
    let stopped = 0
    const started = ctx.manager.start("wt-1", () => gate.promise)

    ctx.manager.stop("wt-1")
    gate.resolve({ stop: () => stopped++ })
    await started

    expect(stopped).toBe(1)
    expect(ctx.statuses.map((s) => s.state)).toEqual(["running", "stopping"])
  })

  it("records startup errors as idle status", async () => {
    const ctx = createManager()

    await ctx.manager.start("wt-1", async () => {
      throw new Error("task failed")
    })

    expect(ctx.manager.status("wt-1")).toMatchObject({ state: "idle", error: "task failed" })
    expect(ctx.statuses.map((s) => s.state)).toEqual(["running", "idle"])
  })

  it("removes idle state and disposes active state", async () => {
    const ctx = createManager()
    let stopped = 0
    await ctx.manager.start("wt-1", async () => ({ stop: () => stopped++ }))

    ctx.manager.remove("wt-1")

    expect(stopped).toBe(1)
    expect(ctx.manager.all()).toEqual([])
  })

  it("disposes all active handles", async () => {
    const ctx = createManager()
    let stopped = 0
    let disposed = 0
    await ctx.manager.start("wt-1", async () => ({ stop: () => stopped++, dispose: () => disposed++ }))

    ctx.manager.dispose()

    expect(stopped).toBe(1)
    expect(disposed).toBe(1)
    expect(ctx.manager.all()).toEqual([])
  })

  it("disposes multiple worktrees and skips idle entries", async () => {
    const ctx = createManager()
    let stopped = 0
    await ctx.manager.start("wt-1", async () => ({ stop: () => stopped++ }))
    await ctx.manager.start("wt-2", async () => ({ stop: () => stopped++ }))
    // wt-3 is started then finished — should be idle and not stopped again
    await ctx.manager.start("wt-3", async () => ({ stop: () => stopped++ }))
    ctx.manager.finish("wt-3", { exitCode: 0 })

    ctx.manager.dispose()

    expect(stopped).toBe(2)
    expect(ctx.manager.all()).toEqual([])
  })

  it("finish after remove does not resurrect stale state", async () => {
    const ctx = createManager()
    await ctx.manager.start("wt-1", async () => ({ stop: () => {} }))
    ctx.manager.remove("wt-1")
    ctx.manager.finish("wt-1", { exitCode: 0 })

    expect(ctx.manager.all()).toEqual([])
  })

  it("dispose tolerates handles that throw on stop", async () => {
    const ctx = createManager()
    await ctx.manager.start("wt-1", async () => ({
      stop: () => {
        throw new Error("stop failed")
      },
    }))

    ctx.manager.dispose()

    expect(ctx.manager.all()).toEqual([])
    expect(ctx.logs.some((m) => m.includes("stop failed"))).toBe(true)
  })
})
