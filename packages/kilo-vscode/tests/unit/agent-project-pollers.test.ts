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
