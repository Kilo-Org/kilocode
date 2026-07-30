import { describe, expect, it } from "bun:test"
import { ProjectContext, type ProjectContextDeps } from "../../src/agent-manager/project/context"
import { reactivateProject } from "../../src/agent-manager/project/init"
import type { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

const ROOT = "/repo/main"

function fakeState(): WorktreeStateManager {
  return {
    getWorktrees: () => [],
    getSessions: () => [],
    flush: async () => {},
  } as unknown as WorktreeStateManager
}

function makeContext(): ProjectContext {
  const deps: ProjectContextDeps = { log: () => {}, state: () => fakeState() }
  const ctx = new ProjectContext("prj-test", ROOT, false, deps)
  ctx.stateManager()
  return ctx
}

describe("reactivateProject", () => {
  it("returns false for a cold context that never initialized", () => {
    const ctx = makeContext()
    const pushed: string[] = []
    expect(reactivateProject(ctx, undefined, () => pushed.push(ctx.id))).toBe(false)
    expect(pushed).toHaveLength(0)
  })

  it("re-registers and pushes in-memory state for a ready context", async () => {
    const ctx = makeContext()
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    const registered = new Map<string, string>()
    const pushed: string[] = []
    const ok = reactivateProject(
      ctx,
      {
        setSessionDirectory: (id, dir) => registered.set(id, dir),
        trackSession: () => {},
      },
      () => pushed.push(ctx.id),
    )
    expect(ok).toBe(true)
    expect(pushed).toEqual(["prj-test"])
  })

  it("returns false after the context is suspended", async () => {
    const ctx = makeContext()
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    ctx.suspend()
    expect(reactivateProject(ctx, undefined, () => {})).toBe(false)
  })
})
