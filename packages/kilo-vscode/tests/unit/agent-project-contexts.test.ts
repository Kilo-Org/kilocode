import { describe, it, expect } from "bun:test"
import { ProjectContexts } from "../../src/agent-manager/project/contexts"
import { ProjectRegistry, type StoredProject } from "../../src/agent-manager/project/registry"
import { projectIdFor } from "../../src/agent-manager/project/paths"
import type { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

const WORKSPACE = "/repo/main"
const PINNED = projectIdFor(WORKSPACE)

function stored(id: string, trusted = false): StoredProject {
  return {
    id,
    root: `/repo/${id}`,
    order: 1,
    trusted,
    addedAt: new Date().toISOString(),
  }
}

function setup(
  opts: { workspace?: string; enabled?: boolean; projects?: StoredProject[]; expanded?: Record<string, boolean> } = {},
) {
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
    trusted: (id) => registry.get(id)?.trusted === true,
    enabled: () => opts.enabled ?? false,
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

  it("has no active project without a workspace when the flag is off", () => {
    const { contexts } = setup({ enabled: false })
    expect(contexts.active()).toBeUndefined()
  })

  it("falls back to the first trusted registry project without a workspace", () => {
    const extra = stored("prj-extra", true)
    const { contexts } = setup({ enabled: true, projects: [extra] })
    expect(contexts.active()?.id).toBe("prj-extra")
  })

  it("rejects activating registry projects when the flag is off", () => {
    const extra = stored("prj-extra", true)
    const { contexts } = setup({ workspace: WORKSPACE, enabled: false, projects: [extra] })
    expect(contexts.activate("prj-extra")).toBeUndefined()
    expect(contexts.active()?.id).toBe(PINNED)
  })

  it("rejects activating untrusted projects", () => {
    const extra = stored("prj-extra", false)
    const { contexts } = setup({ workspace: WORKSPACE, enabled: true, projects: [extra] })
    expect(contexts.activate("prj-extra")).toBeUndefined()
    expect(contexts.active()?.id).toBe(PINNED)
  })

  it("activates trusted projects without changing accordion expansion", () => {
    const extra = stored("prj-extra", true)
    const { contexts } = setup({ workspace: WORKSPACE, enabled: true, projects: [extra] })
    const ctx = contexts.activate("prj-extra")
    expect(ctx?.root).toBe("/repo/prj-extra")
    expect(contexts.active()?.id).toBe("prj-extra")
    expect(contexts.isExpanded("prj-extra")).toBe(false)
  })

  it("keeps explicit accordion expansion unchanged after switching", () => {
    const extra = stored("prj-extra", true)
    const { contexts } = setup({ workspace: WORKSPACE, enabled: true, projects: [extra] })
    contexts.active()
    contexts.expand("prj-extra")
    contexts.activate("prj-extra")
    expect(contexts.active()?.id).toBe("prj-extra")
    expect(contexts.isExpanded(PINNED)).toBe(true)
    contexts.activate(PINNED)
    expect(contexts.isExpanded("prj-extra")).toBe(true)
  })

  it("expands without changing the active project", () => {
    const extra = stored("prj-extra", true)
    const { contexts } = setup({ workspace: WORKSPACE, enabled: true, projects: [extra] })
    expect(contexts.expand("prj-extra")?.id).toBe("prj-extra")
    expect(contexts.active()?.id).toBe(PINNED)
    expect(contexts.isExpanded("prj-extra")).toBe(true)
  })

  it("allows accordion collapse independently from active detail selection", () => {
    const extra = stored("prj-extra", true)
    const { contexts } = setup({ workspace: WORKSPACE, enabled: true, projects: [extra] })
    contexts.activate("prj-extra")
    contexts.collapse("prj-extra")
    expect(contexts.isExpanded("prj-extra")).toBe(false)
    expect(contexts.active()?.id).toBe("prj-extra")
  })

  it("removes projects and falls back to the pinned project", async () => {
    const extra = stored("prj-extra", true)
    const { contexts } = setup({ workspace: WORKSPACE, enabled: true, projects: [extra] })
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
    const extra = stored("prj-extra", true)
    const { contexts, created } = setup({ workspace: WORKSPACE, enabled: true, projects: [extra] })
    contexts.active()!.stateManager()
    contexts.activate("prj-extra")!.stateManager()
    expect(created).toEqual([WORKSPACE, "/repo/prj-extra"])
  })

  it("re-derives the pinned project when the workspace changes", () => {
    const ws: { root: string | undefined } = { root: undefined }
    const { contexts } = setup({ enabled: false })
    const dynamic = new ProjectContexts({
      workspaceRoot: () => ws.root,
      registry: { list: () => [], get: () => undefined },
      trusted: () => false,
      enabled: () => false,
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
  })

  it("snapshots pinned first with registry projects in order", () => {
    const extra = stored("prj-extra", true)
    const { contexts } = setup({ workspace: WORKSPACE, enabled: true, projects: [extra] })
    const list = contexts.snapshots()
    expect(list.map((p) => p.id)).toEqual([PINNED, "prj-extra"])
    expect(list[0]!.pinned).toBe(true)
    expect(list[0]!.active).toBe(true)
    expect(list[0]!.trusted).toBe(true)
    expect(list[1]!.label).toBe("prj-extra")
    expect(list[1]!.initialized).toBe(false)
  })

  it("keeps the pinned project expanded before active state is initialized", () => {
    const { contexts } = setup({ workspace: WORKSPACE })

    expect(contexts.isExpanded(PINNED)).toBe(true)
  })

  it("hydrates persisted project expansion without initializing the project", () => {
    const extra = stored("prj-extra", true)
    const { contexts } = setup({
      workspace: WORKSPACE,
      enabled: true,
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

  it("hides registry projects from snapshots when the flag is off", () => {
    const extra = stored("prj-extra", true)
    const { contexts } = setup({ workspace: WORKSPACE, enabled: false, projects: [extra] })
    expect(contexts.snapshots().map((p) => p.id)).toEqual([PINNED])
  })

  it("returns active ownership to pinned Local when multi-project is disabled", () => {
    const extra = stored("prj-extra", true)
    const { contexts } = setup({ workspace: WORKSPACE, enabled: true, projects: [extra] })
    const secondary = contexts.expand("prj-extra")!
    contexts.activate("prj-extra")

    const pinned = contexts.disable()

    expect(pinned?.id).toBe(PINNED)
    expect(contexts.active()?.id).toBe(PINNED)
    expect(contexts.isExpanded(PINNED)).toBe(true)
    expect(contexts.isExpanded("prj-extra")).toBe(false)
    expect(secondary.lifecycle).toBe("suspended")
  })

  it("dedupes registry entries that match the pinned project", () => {
    const dupe = stored(PINNED, true)
    const { contexts } = setup({ workspace: WORKSPACE, enabled: true, projects: [dupe] })
    expect(contexts.snapshots().map((p) => p.id)).toEqual([PINNED])
  })
})
