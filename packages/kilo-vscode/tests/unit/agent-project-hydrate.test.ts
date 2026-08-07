import { describe, expect, it } from "bun:test"
import { ProjectContext, type ProjectContextDeps } from "../../src/agent-manager/project/context"
import type { ProjectSnapshot } from "../../src/agent-manager/project/contexts"
import { hydrateExpanded } from "../../src/agent-manager/project/hydrate"
import type { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

const deps: ProjectContextDeps = {
  log: () => {},
  state: () =>
    ({ getWorktrees: () => [], getSessions: () => [], flush: async () => {} }) as unknown as WorktreeStateManager,
}

function snapshot(id: string, over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    id,
    root: `/repo/${id}`,
    label: id,
    pinned: false,
    active: false,
    expanded: true,
    initialized: false,
    trusted: true,
    missing: false,
    ...over,
  }
}

/** Contexts keyed by id, created cold. */
function contexts(ids: string[]) {
  const map = new Map(ids.map((id) => [id, new ProjectContext(id, `/repo/${id}`, false, deps)]))
  return {
    map,
    hooks: () => {
      const pushed: string[] = []
      const inited: string[] = []
      return {
        pushed,
        inited,
        expand: (id: string) => map.get(id),
        push: (ctx: ProjectContext) => pushed.push(ctx.id),
        init: (ctx: ProjectContext) => inited.push(ctx.id),
      }
    },
  }
}

describe("hydrateExpanded", () => {
  it("loads a cold expanded background project", () => {
    const all = contexts(["a"])
    const hooks = all.hooks()
    hydrateExpanded([snapshot("a")], hooks)
    expect(hooks.inited).toEqual(["a"])
    expect(hooks.pushed).toEqual([])
  })

  /**
   * Regression: a background project loads asynchronously, so its state push can
   * land before the webview mounts. The catalog push that follows the mount must
   * re-push it, otherwise the accordion stays on loading placeholders until the
   * user clicks a row inside the project.
   */
  it("re-pushes state for an already loaded background project", async () => {
    const all = contexts(["a"])
    await all.map.get("a")!.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    const hooks = all.hooks()
    hydrateExpanded([snapshot("a")], hooks)
    expect(hooks.pushed).toEqual(["a"])
    expect(hooks.inited).toEqual([])
  })

  it("skips the active project, which the provider pushes itself", async () => {
    const all = contexts(["a"])
    await all.map.get("a")!.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    const hooks = all.hooks()
    hydrateExpanded([snapshot("a", { active: true })], hooks)
    expect(hooks.pushed).toEqual([])
    expect(hooks.inited).toEqual([])
  })

  it("skips collapsed, untrusted, and missing projects", () => {
    const all = contexts(["collapsed", "untrusted", "missing"])
    const hooks = all.hooks()
    hydrateExpanded(
      [
        snapshot("collapsed", { expanded: false }),
        snapshot("untrusted", { trusted: false }),
        snapshot("missing", { missing: true }),
      ],
      hooks,
    )
    expect(hooks.pushed).toEqual([])
    expect(hooks.inited).toEqual([])
  })

  it("skips a project the coordinator refuses to expand", () => {
    const hooks = {
      pushed: [] as string[],
      inited: [] as string[],
      expand: () => undefined,
      push: () => {},
      init: () => {},
    }
    hydrateExpanded([snapshot("gone")], hooks)
    expect(hooks.pushed).toEqual([])
    expect(hooks.inited).toEqual([])
  })

  it("hydrates every expanded background project, not just the first", async () => {
    const all = contexts(["a", "b", "c"])
    await all.map.get("b")!.ensureReady(async () => ({ ok: true, refsFixed: 0 }))
    const hooks = all.hooks()
    hydrateExpanded([snapshot("a"), snapshot("b"), snapshot("c")], hooks)
    expect(hooks.inited).toEqual(["a", "c"])
    expect(hooks.pushed).toEqual(["b"])
  })
})
