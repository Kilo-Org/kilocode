import { describe, it, expect } from "bun:test"
import { ProjectContexts } from "../../src/agent-manager/project/contexts"
import type { StoredProject } from "../../src/agent-manager/project/registry"
import { projectIdFor } from "../../src/agent-manager/project/paths"
import type { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

const WORKSPACE = "/repo/main"
const PINNED = projectIdFor(WORKSPACE)

function stored(id: string): StoredProject {
  return {
    id,
    root: `/repo/${id}`,
    order: 1,
    addedAt: new Date().toISOString(),
  }
}

function setup(opts: { workspace?: string; projects?: StoredProject[]; expanded?: Record<string, boolean> } = {}) {
  const registryProjects = opts.projects ?? []
  const registry = {
    list: () => registryProjects,
    get: (id: string) => registryProjects.find((p) => p.id === id),
    expanded: (id: string) => opts.expanded?.[id],
  }
  const created: string[] = []
  const contexts = new ProjectContexts({
    workspaceRoot: () => opts.workspace,
    registry,
    deps: {
      log: () => {},
      exists: () => true,
      state: (root) => {
        created.push(root)
        return { root, flush: async () => {} } as unknown as WorktreeStateManager
      },
    },
  })
  return { contexts, created, registryProjects }
}

describe("ProjectContexts", () => {
  it("derives the pinned project from the current workspace root", () => {
    const { contexts } = setup({ workspace: WORKSPACE })
    const active = contexts.active()
    expect(active?.id).toBe(PINNED)
    expect(active?.root).toBe(WORKSPACE)
    expect(active?.pinned).toBe(true)
  })

  it("has no active project without a workspace or registered projects", () => {
    const { contexts } = setup()
    expect(contexts.active()).toBeUndefined()
    expect(contexts.snapshots()).toEqual([])
  })

  it("falls back to the first registry project without a workspace", () => {
    const extra = stored("prj-extra")
    const { contexts } = setup({ projects: [extra] })
    expect(contexts.active()?.id).toBe("prj-extra")
  })

  it("rejects unknown projects without changing the active project", () => {
    const { contexts } = setup({ workspace: WORKSPACE })
    expect(contexts.activate("prj-unknown")).toBeUndefined()
    expect(contexts.expand("prj-unknown")).toBeUndefined()
    expect(contexts.active()?.id).toBe(PINNED)
  })

  it("activates registered projects", () => {
    const extra = stored("prj-extra")
    const { contexts } = setup({ workspace: WORKSPACE, projects: [extra] })
    const ctx = contexts.activate("prj-extra")
    expect(ctx?.root).toBe("/repo/prj-extra")
    expect(contexts.active()?.id).toBe("prj-extra")
    expect(contexts.isExpanded("prj-extra")).toBe(false)
  })

  it("keeps explicit accordion expansion unchanged after switching", () => {
    const extra = stored("prj-extra")
    const { contexts } = setup({ workspace: WORKSPACE, projects: [extra] })
    contexts.active()
    contexts.expand("prj-extra")
    contexts.activate("prj-extra")
    expect(contexts.active()?.id).toBe("prj-extra")
    expect(contexts.isExpanded(PINNED)).toBe(true)
    contexts.activate(PINNED)
    expect(contexts.isExpanded("prj-extra")).toBe(true)
  })

  it("expands without changing the active project", () => {
    const extra = stored("prj-extra")
    const { contexts } = setup({ workspace: WORKSPACE, projects: [extra] })
    expect(contexts.expand("prj-extra")?.id).toBe("prj-extra")
    expect(contexts.active()?.id).toBe(PINNED)
    expect(contexts.isExpanded("prj-extra")).toBe(true)
  })

  it("allows accordion collapse independently from active detail selection", () => {
    const extra = stored("prj-extra")
    const { contexts } = setup({ workspace: WORKSPACE, projects: [extra] })
    contexts.activate("prj-extra")
    contexts.collapse("prj-extra")
    expect(contexts.isExpanded("prj-extra")).toBe(false)
    expect(contexts.active()?.id).toBe("prj-extra")
  })

  it("removes projects and falls back to the pinned project", async () => {
    const extra = stored("prj-extra")
    const { contexts } = setup({ workspace: WORKSPACE, projects: [extra] })
    contexts.activate("prj-extra")
    await contexts.remove("prj-extra")
    expect(contexts.get("prj-extra")).toBeUndefined()
    expect(contexts.active()?.id).toBe(PINNED)
  })

  it("initializes each context once while concurrent callers wait", async () => {
    const { contexts } = setup({ workspace: WORKSPACE })
    const ctx = contexts.active()!
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    let calls = 0
    const run = async () => {
      calls++
      await gate
      return { ok: true, refsFixed: 0 }
    }
    const first = ctx.ensureReady(run)
    const second = ctx.ensureReady(run)
    expect(first).toBe(second)
    expect(calls).toBe(1)
    release!()
    expect((await first).current).toBe(true)
    expect(ctx.lifecycle).toBe("ready")
  })

  it("invalidates initialization when suspended", async () => {
    const { contexts } = setup({ workspace: WORKSPACE })
    const ctx = contexts.active()!
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const init = ctx.ensureReady(async () => {
      await gate
      return { ok: true, refsFixed: 0 }
    })
    ctx.suspend()
    release!()
    expect((await init).current).toBe(false)
    expect(ctx.lifecycle).toBe("suspended")
  })

  it("creates repository services lazily, once per context", () => {
    const { contexts, created } = setup({ workspace: WORKSPACE })
    expect(created).toEqual([])
    const active = contexts.active()!
    active.stateManager()
    active.stateManager()
    expect(created).toEqual([WORKSPACE])
    expect(active.loaded).toBe(true)
  })

  it("isolates services between projects", () => {
    const extra = stored("prj-extra")
    const { contexts, created } = setup({ workspace: WORKSPACE, projects: [extra] })
    contexts.active()!.stateManager()
    contexts.activate("prj-extra")!.stateManager()
    expect(created).toEqual([WORKSPACE, "/repo/prj-extra"])
  })

  it("re-derives the pinned project when the workspace changes", () => {
    const ws: { root: string | undefined } = { root: undefined }
    const dynamic = new ProjectContexts({
      workspaceRoot: () => ws.root,
      registry: { list: () => [], get: () => undefined },
      deps: { log: () => {}, exists: () => true },
    })
    expect(dynamic.active()).toBeUndefined()
    ws.root = WORKSPACE
    expect(dynamic.syncPinned()).toBe(true)
    expect(dynamic.active()?.id).toBe(PINNED)
    expect(dynamic.syncPinned()).toBe(false)
    ws.root = "/repo/other"
    expect(dynamic.syncPinned()).toBe(true)
    expect(dynamic.active()?.root).toBe("/repo/other")
    ws.root = undefined
    expect(dynamic.syncPinned()).toBe(true)
    expect(dynamic.active()).toBeUndefined()
    expect(dynamic.snapshots()).toEqual([])
  })

  it("snapshots pinned first with registry projects in order", () => {
    const extra = stored("prj-extra")
    const { contexts } = setup({ workspace: WORKSPACE, projects: [extra] })
    const list = contexts.snapshots()
    expect(list.map((p) => p.id)).toEqual([PINNED, "prj-extra"])
    expect(list[0]!.pinned).toBe(true)
    expect(list[0]!.active).toBe(true)
    expect(list[1]!.label).toBe("prj-extra")
    expect(list[1]!.initialized).toBe(false)
  })

  it("keeps the pinned project expanded before active state is initialized", () => {
    const { contexts } = setup({ workspace: WORKSPACE })

    expect(contexts.isExpanded(PINNED)).toBe(true)
  })

  it("hydrates persisted project expansion without initializing the project", () => {
    const extra = stored("prj-extra")
    const { contexts } = setup({
      workspace: WORKSPACE,
      projects: [extra],
      expanded: { [extra.id]: true },
    })

    const list = contexts.snapshots()

    expect(list[1]!.expanded).toBe(true)
    expect(list[1]!.initialized).toBe(false)
    expect(contexts.get(extra.id)).toBeUndefined()
  })

  it("hydrates a persisted collapsed pinned project", () => {
    const { contexts } = setup({ workspace: WORKSPACE, expanded: { [PINNED]: false } })

    expect(contexts.snapshots()[0]!.expanded).toBe(false)
  })

  it("dedupes registry entries that match the pinned project", () => {
    const dupe = stored(PINNED)
    const { contexts } = setup({ workspace: WORKSPACE, projects: [dupe] })
    expect(contexts.snapshots().map((p) => p.id)).toEqual([PINNED])
  })
})
