import { describe, it, expect } from "bun:test"
import { handleProjectMessage, type ProjectMessageDeps } from "../../src/agent-manager/project/messages"
import type { ProjectContext, ProjectInitResult } from "../../src/agent-manager/project/context"
import { ProjectContexts } from "../../src/agent-manager/project/contexts"
import { projectIdFor } from "../../src/agent-manager/project/paths"
import type { AgentManagerInMessage } from "../../src/agent-manager/types"
import type { StoredProject } from "../../src/agent-manager/project/registry"
import type { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

const WORKSPACE = "/repo/main"
const PINNED = projectIdFor(WORKSPACE)

function stored(id: string, trusted = true): StoredProject {
  return { id, root: `/repo/${id}`, order: 1, trusted, addedAt: new Date().toISOString() }
}

function fakeState(persisted?: { current?: unknown }) {
  const store = persisted ?? {}
  return {
    getWorktree: (id: string) => (id === "wt1" ? { path: "/repo/prj-extra/wt1" } : undefined),
    getSession: (id: string) => (id === "sess1" ? {} : undefined),
    getActiveTarget: () => store.current,
    setActiveTarget: (target: unknown) => {
      store.current = target
    },
  } as unknown as WorktreeStateManager
}

function setup(
  opts: {
    enabled?: boolean
    workspace?: string
    ready?: (ctx: ProjectContext) => Promise<ProjectInitResult>
    state?: () => WorktreeStateManager
  } = {},
) {
  const extra = "prj-extra"
  const projects = [stored(extra, true)]
  const registry = {
    list: () => projects,
    get: (id: string) => projects.find((p) => p.id === id),
  }
  const contexts = new ProjectContexts({
    workspaceRoot: () => opts.workspace ?? WORKSPACE,
    registry,
    trusted: (id) => registry.get(id)?.trusted === true,
    enabled: () => opts.enabled ?? true,
    deps: {
      log: () => {},
      exists: () => true,
      state: opts.state ?? (() => fakeState()),
    },
  })
  const calls = {
    activate: [] as string[],
    expand: [] as string[],
    push: 0,
    error: [] as string[],
    selected: [] as string[],
    ready: [] as string[],
  }
  const readyImpl =
    opts.ready ??
    (async (ctx: ProjectContext) => {
      calls.ready.push(ctx.id)
      return ctx.ensureReady(async () => {
        ctx.stateManager()
        return { ok: true, refsFixed: 0 }
      })
    })
  const deps: ProjectMessageDeps = {
    registry: registry as never,
    contexts,
    enabled: () => opts.enabled ?? true,
    pickFolder: async () => undefined,
    activate: (ctx) => calls.activate.push(ctx.id),
    expand: (ctx) => calls.expand.push(ctx.id),
    push: () => calls.push++,
    error: (message) => calls.error.push(message),
    ready: readyImpl,
    selected: (target) => calls.selected.push(target.kind === "local" ? target.projectId : target.kind),
    log: () => {},
  }
  return { contexts, deps, calls, extra }
}

function activateMsg(projectId: string, extra: Record<string, unknown> = {}): AgentManagerInMessage {
  return {
    type: "agentManager.activateSelection",
    target: { projectId, kind: "local", ...extra },
  } as unknown as AgentManagerInMessage
}

describe("activateSelection — cross-project selection", () => {
  it("acknowledges a ready cross-project local selection without re-running completed initialization", async () => {
    const { contexts, deps, calls, extra } = setup()
    const ctx = contexts.expand(extra)!
    ctx.stateManager()
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    expect(ctx.lifecycle).toBe("ready")

    calls.ready = []
    await handleProjectMessage(activateMsg(extra), deps)

    expect(contexts.active()?.id).toBe(extra)
    expect(calls.activate).toEqual([extra])
    expect(calls.ready).toEqual([extra])
    expect(calls.selected).toEqual([extra])
    expect(calls.error).toEqual([])
  })

  it("waits for readiness on a cold (never-initialized) selection", async () => {
    const { contexts, deps, calls, extra } = setup()
    expect(contexts.get(extra)).toBeUndefined()

    await handleProjectMessage(activateMsg(extra), deps)

    expect(contexts.get(extra)?.lifecycle).toBe("ready")
    expect(contexts.active()?.id).toBe(extra)
    expect(calls.ready).toEqual([extra])
    expect(calls.activate).toEqual([extra])
    expect(calls.selected).toEqual([extra])
  })

  it("falls back to local without an error toast when the target is gone", async () => {
    const { contexts, deps, calls, extra } = setup()
    contexts.activate(PINNED)
    expect(contexts.active()?.id).toBe(PINNED)

    await handleProjectMessage(activateMsg(extra, { kind: "worktree", worktreeId: "missing" }), deps)

    // A stale target is not actionable, so the selection lands on the
    // project's local context instead of surfacing an error.
    expect(contexts.active()?.id).toBe(extra)
    expect(calls.activate).toEqual([extra])
    expect(calls.selected).toEqual([extra])
    expect(calls.error).toEqual([])
  })

  it("does not re-run initialization for an already-ready context", async () => {
    const { contexts, deps, calls, extra } = setup()
    const ctx = contexts.expand(extra)!
    ctx.stateManager()
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    expect(ctx.lifecycle).toBe("ready")

    const readyCalls: string[] = []
    deps.ready = async (c) => {
      readyCalls.push(c.id)
      return { ok: true, refsFixed: 0, current: true }
    }

    await handleProjectMessage(activateMsg(extra), deps)
    await handleProjectMessage(activateMsg(extra), deps)

    expect(readyCalls).toEqual([extra, extra])
    const initField = (ctx as unknown as { init?: unknown }).init
    expect(initField).toBeUndefined()
  })

  it("does not reset project services when selecting within the active project", async () => {
    const { contexts, deps, calls, extra } = setup()
    const ctx = contexts.expand(extra)!
    ctx.stateManager()
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    contexts.activate(extra)

    await handleProjectMessage(activateMsg(extra, { kind: "worktree", worktreeId: "wt1" }), deps)

    expect(contexts.active()?.id).toBe(extra)
    expect(calls.activate).toEqual([])
    expect(calls.selected).toEqual(["worktree"])
    expect(calls.error).toEqual([])
  })

  it("restores the persisted target when the selection asks for it", async () => {
    const persisted = { current: undefined as unknown }
    const { contexts, deps, calls, extra } = setup({ state: () => fakeState(persisted) })
    const ctx = contexts.expand(extra)!
    ctx.stateManager()
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    persisted.current = { projectId: extra, kind: "worktree", worktreeId: "wt1" }

    await handleProjectMessage(
      { type: "agentManager.activateSelection", target: { projectId: extra, kind: "local" }, restore: true } as never,
      deps,
    )

    expect(calls.selected).toEqual(["worktree"])
    expect(calls.error).toEqual([])
  })

  it("falls back to the requested target when the persisted one is gone", async () => {
    const persisted = { current: { projectId: "prj-extra", kind: "worktree", worktreeId: "missing" } as unknown }
    const { contexts, deps, calls, extra } = setup({ state: () => fakeState(persisted) })
    const ctx = contexts.expand(extra)!
    ctx.stateManager()
    await ctx.ensureReady(async () => ({ ok: true, refsFixed: 0 }))

    await handleProjectMessage(
      { type: "agentManager.activateSelection", target: { projectId: extra, kind: "local" }, restore: true } as never,
      deps,
    )

    expect(calls.selected).toEqual([extra])
    expect(calls.error).toEqual([])
  })
})
