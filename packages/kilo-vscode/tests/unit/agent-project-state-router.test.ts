import { describe, expect, it } from "bun:test"
import { createProjectStateRouter } from "../../webview-ui/agent-manager/project/state"
import type { AgentManagerStateMessage, AgentProjectSnapshot } from "../../src/types/messages"

const state = (projectId: string) => ({ type: "agentManager.state", projectId }) as AgentManagerStateMessage
const project = (id: string, active = false) => ({ id, label: id, root: `/repo/${id}`, active }) as AgentProjectSnapshot

function setup(catalog: AgentProjectSnapshot[] = []) {
  const calls: { applied: string[]; pruned: string[][] } = { applied: [], pruned: [] }
  let list = catalog
  const router = createProjectStateRouter({
    catalog: () => list,
    apply: (s) => calls.applied.push(s.projectId ?? ""),
    pruneLive: (ids) => calls.pruned.push([...ids]),
  })
  return { router, calls, set: (projects: AgentProjectSnapshot[]) => (list = projects) }
}

describe("createProjectStateRouter", () => {
  it("applies state directly when the catalog is empty (legacy mode)", () => {
    const { router, calls } = setup()
    expect(router.routeState(state("prj-a"))).toBe("applied")
    expect(calls.applied).toEqual(["prj-a"])
  })

  it("defers state that arrives before its catalog activation and flushes it", () => {
    const { router, calls, set } = setup([project("prj-a", true), project("prj-b")])

    expect(router.routeState(state("prj-b"))).toBe("deferred")
    expect(calls.applied).toEqual([])

    set([project("prj-a"), project("prj-b", true)])
    router.routeCatalog([project("prj-a"), project("prj-b", true)])
    expect(calls.applied).toEqual(["prj-b"])
  })

  it("applies state immediately when its project is already catalog-active", () => {
    const { router, calls } = setup([project("prj-a", true), project("prj-b")])
    expect(router.routeState(state("prj-a"))).toBe("applied")
    expect(calls.applied).toEqual(["prj-a"])
  })

  it("keeps the newest deferred state per project", () => {
    const { router, calls, set } = setup([project("prj-a", true)])
    router.routeState({ ...state("prj-b"), worktrees: [{ id: "1" }] } as never)
    router.routeState({ ...state("prj-b"), worktrees: [{ id: "1" }, { id: "2" }] } as never)
    set([project("prj-b", true)])
    router.routeCatalog([project("prj-b", true)])
    expect(calls.applied).toHaveLength(1)
  })

  it("drops deferred state for projects removed from the catalog", () => {
    const { router, calls, set } = setup([project("prj-a", true), project("prj-b")])
    router.routeState(state("prj-b"))
    set([project("prj-a", true)])
    router.routeCatalog([project("prj-a", true)])
    expect(calls.applied).toEqual([])
    expect(calls.pruned.at(-1)).toEqual(["prj-a"])
  })

  it("does not flush deferred state for a project that is not the active one", () => {
    const { router, calls, set } = setup([project("prj-a", true), project("prj-b")])
    router.routeState(state("prj-b"))
    set([project("prj-c", true)])
    router.routeCatalog([project("prj-a"), project("prj-b"), project("prj-c", true)])
    expect(calls.applied).toEqual([])
  })
})
