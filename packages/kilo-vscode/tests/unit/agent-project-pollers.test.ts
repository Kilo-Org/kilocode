import { describe, it, expect } from "bun:test"
import { ProjectPollers, type PollerPair, type StatsOutMessage } from "../../src/agent-manager/project/pollers"
import { ProjectContexts } from "../../src/agent-manager/project/contexts"
import type { StoredProject } from "../../src/agent-manager/project/registry"
import { projectIdFor } from "../../src/agent-manager/project/paths"
import type { GitOps } from "../../src/agent-manager/GitOps"
import type { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

const WORKSPACE = "/repo/main"
const PINNED = projectIdFor(WORKSPACE)

function stored(id: string, trusted = true): StoredProject {
  return { id, root: `/repo/${id}`, order: 1, trusted, addedAt: new Date().toISOString() }
}

function setup(projects: StoredProject[], opts: { enabled?: boolean } = {}) {
  const contexts = new ProjectContexts({
    workspaceRoot: () => WORKSPACE,
    registry: {
      list: () => projects,
      get: (id) => projects.find((p) => p.id === id),
    },
    trusted: (id) => projects.find((p) => p.id === id)?.trusted === true,
    enabled: () => opts.enabled ?? true,
    deps: {
      log: () => {},
      exists: () => true,
      state: () => ({ flush: async () => {} }) as unknown as WorktreeStateManager,
    } as never,
  })
  return contexts
}

/** Expand a project and mark its state as initialized (as initExpanded would). */
function expand(contexts: ProjectContexts, id: string, ready = true): void {
  contexts.expand(id)
  if (ready) contexts.get(id)?.stateManager()
}

interface FakePair {
  pair: PollerPair
  enabled: { stats: boolean; pr: boolean }
  visible: { stats: boolean; pr: boolean }
  stopped: { stats: boolean; pr: boolean }
}

function fakes() {
  const posted: StatsOutMessage[] = []
  const made = new Map<string, FakePair>()
  const create = (ctx: { id: string }): PollerPair => {
    const rec: FakePair = {
      pair: {
        stats: {
          setEnabled: (v) => (rec.enabled.stats = v),
          setVisible: (v) => (rec.visible.stats = v),
          stop: () => (rec.stopped.stats = true),
        },
        pr: {
          poller: {
            setEnabled: (v) => (rec.enabled.pr = v),
            setVisible: (v) => (rec.visible.pr = v),
            stop: () => (rec.stopped.pr = true),
          },
        },
      },
      enabled: { stats: false, pr: false },
      visible: { stats: true, pr: true },
      stopped: { stats: false, pr: false },
    }
    made.set(ctx.id, rec)
    return rec.pair
  }
  const deps = {
    git: {} as GitOps,
    semaphore: undefined as never,
    localDiff: async () => [],
    post: (msg: StatsOutMessage) => posted.push(msg),
    openExternal: () => {},
    visible: () => true,
    log: () => {},
  }
  return { posted, made, create, deps }
}

describe("ProjectPollers", () => {
  it("starts pollers for an expanded trusted background project", () => {
    const extra = stored("prj-extra")
    const contexts = setup([extra])
    expand(contexts, "prj-extra")
    const { made, create, deps } = fakes()
    const pollers = new ProjectPollers(deps, (ctx) => create(ctx))
    pollers.sync(contexts)
    const rec = made.get("prj-extra")
    expect(rec).toBeDefined()
    expect(rec!.enabled).toEqual({ stats: true, pr: true })
  })

  it("does not start pollers for the active project", () => {
    const contexts = setup([])
    contexts.active()
    const { made, create, deps } = fakes()
    const pollers = new ProjectPollers(deps, (ctx) => create(ctx))
    pollers.sync(contexts)
    expect(made.has(PINNED)).toBe(false)
  })

  it("stops pollers when a project is collapsed", () => {
    const extra = stored("prj-extra")
    const contexts = setup([extra])
    expand(contexts, "prj-extra")
    const { made, create, deps } = fakes()
    const pollers = new ProjectPollers(deps, (ctx) => create(ctx))
    pollers.sync(contexts)
    contexts.collapse("prj-extra")
    pollers.sync(contexts)
    const rec = made.get("prj-extra")
    expect(rec!.stopped).toEqual({ stats: true, pr: true })
  })

  it("stops pollers when a project is removed", () => {
    const extra = stored("prj-extra")
    const contexts = setup([extra])
    expand(contexts, "prj-extra")
    const { made, create, deps } = fakes()
    const pollers = new ProjectPollers(deps, (ctx) => create(ctx))
    pollers.sync(contexts)
    contexts.remove("prj-extra")
    pollers.sync(contexts)
    expect(made.get("prj-extra")!.stopped.stats).toBe(true)
  })

  it("skips projects whose state is not initialized yet", () => {
    const extra = stored("prj-extra")
    const contexts = setup([extra])
    expand(contexts, "prj-extra", false)
    const { made, create, deps } = fakes()
    const pollers = new ProjectPollers(deps, (ctx) => create(ctx))
    pollers.sync(contexts)
    expect(made.has("prj-extra")).toBe(false)
  })

  it("does not duplicate pollers on repeated syncs", () => {
    const extra = stored("prj-extra")
    const contexts = setup([extra])
    expand(contexts, "prj-extra")
    const { made, create, deps } = fakes()
    const pollers = new ProjectPollers(deps, (ctx) => create(ctx))
    pollers.sync(contexts)
    pollers.sync(contexts)
    expect(made.size).toBe(1)
  })

  it("stops pollers for a background project that becomes active", () => {
    const extra = stored("prj-extra")
    const contexts = setup([extra])
    expand(contexts, "prj-extra")
    const { made, create, deps } = fakes()
    const pollers = new ProjectPollers(deps, (ctx) => create(ctx))
    pollers.sync(contexts)
    contexts.activate("prj-extra")
    pollers.sync(contexts)
    expect(made.get("prj-extra")!.stopped.stats).toBe(true)
  })

  it("disposes all pollers", () => {
    const extra = stored("prj-extra")
    const contexts = setup([extra])
    expand(contexts, "prj-extra")
    const { made, create, deps } = fakes()
    const pollers = new ProjectPollers(deps, (ctx) => create(ctx))
    pollers.sync(contexts)
    pollers.dispose()
    expect(made.get("prj-extra")!.stopped).toEqual({ stats: true, pr: true })
  })
})

/** Poller pair that exposes the injected deps so a test can emit like a real poller. */
function recorder() {
  const posted: StatsOutMessage[] = []
  const emit = new Map<string, (msg: StatsOutMessage) => void>()
  const replayed: string[] = []
  const create = (ctx: { id: string }, injected: { post: (msg: StatsOutMessage) => void }): PollerPair => {
    emit.set(ctx.id, injected.post)
    return {
      stats: { setEnabled: () => {}, setVisible: () => {}, stop: () => {} },
      pr: {
        poller: { setEnabled: () => {}, setVisible: () => {}, stop: () => {} },
        replay: () => replayed.push(ctx.id),
      },
    }
  }
  const deps = {
    git: {} as GitOps,
    semaphore: undefined as never,
    post: (msg: StatsOutMessage) => posted.push(msg),
    openExternal: () => {},
    visible: () => true,
    log: () => {},
  }
  return { posted, emit, replayed, create, deps }
}

const LOCAL: StatsOutMessage = {
  type: "agentManager.localStats",
  projectId: "prj-extra",
  stats: { branch: "main", files: 0, additions: 0, deletions: 0, ahead: 0, behind: 0 } as never,
}

describe("ProjectPollers.replay", () => {
  /**
   * Regression: a background poller only emits on change, so a webview that
   * mounts or reloads after the emit would keep its stats placeholders forever.
   */
  it("re-posts the latest stats for a background project", () => {
    const contexts = setup([stored("prj-extra")])
    expand(contexts, "prj-extra")
    const rec = recorder()
    const pollers = new ProjectPollers(rec.deps as never, rec.create as never)
    pollers.sync(contexts)
    rec.emit.get("prj-extra")!(LOCAL)
    expect(rec.posted).toHaveLength(1)
    pollers.replay()
    expect(rec.posted).toHaveLength(2)
    expect(rec.posted[1]).toBe(LOCAL)
    expect(rec.replayed).toEqual(["prj-extra"])
  })

  it("posts nothing for a project that has not emitted yet", () => {
    const contexts = setup([stored("prj-extra")])
    expand(contexts, "prj-extra")
    const rec = recorder()
    const pollers = new ProjectPollers(rec.deps as never, rec.create as never)
    pollers.sync(contexts)
    pollers.replay()
    expect(rec.posted).toEqual([])
  })

  it("drops cached stats for a collapsed project", () => {
    const contexts = setup([stored("prj-extra")])
    expand(contexts, "prj-extra")
    const rec = recorder()
    const pollers = new ProjectPollers(rec.deps as never, rec.create as never)
    pollers.sync(contexts)
    rec.emit.get("prj-extra")!(LOCAL)
    contexts.collapse("prj-extra")
    pollers.sync(contexts)
    pollers.replay()
    expect(rec.posted).toHaveLength(1)
  })
})
