import { describe, expect, test } from "bun:test"
import { ProjectRouting } from "../../src/agent-manager/project-routing"
import { PROJECT_REGISTRY_STORAGE_KEY } from "../../src/agent-manager/project-registry-store"
import { type Project } from "../../src/agent-manager/project-registry"
import { projectIdFor } from "../../src/agent-manager/project-id"
import type { ProjectContextDeps } from "../../src/agent-manager/project-context"
import { makeMemento } from "./_helpers/memento"

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: projectIdFor("/canonical/seed"),
    root: "/canonical/seed",
    order: 0,
    collapsed: false,
    trusted: false,
    ...overrides,
  }
}

function factoryDeps(): ProjectContextDeps {
  return { buildWorktreeManager: () => ({ placeholder: true }) }
}

function seededMemento(registry: unknown) {
  const m = makeMemento()
  m.seed({ [PROJECT_REGISTRY_STORAGE_KEY]: JSON.stringify(registry) })
  return m
}

function fakeCanonicalRoot(map: Record<string, string>) {
  return async (input: string) => {
    const trimmed = input.replace(/\/$/, "")
    const target = map[trimmed] ?? map[input]
    if (!target) throw new Error(`unexpected canonical root request: ${input}`)
    return target
  }
}

describe("ProjectRouting — add/remove/toggle mutations", () => {
  test("addProject persists a fresh canonical root and exposes it via snapshot", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(
      memento,
      () => factoryDeps(),
      () => {},
      fakeCanonicalRoot({ "/Users/me/code/cloud": "/canonical/cloud" }),
    )
    await routing.load()

    const result = await routing.addProject("/Users/me/code/cloud")
    if (!result.ok) throw new Error("expected ok")
    expect(result.deduplicated).toBe(false)
    expect(result.project.id).toBe(projectIdFor("/canonical/cloud"))
    expect(routing.getProject(result.project.id)?.root).toBe("/canonical/cloud")
    expect(memento.read(PROJECT_REGISTRY_STORAGE_KEY)).toBeDefined()
  })

  test("addProject dedups and does not write to disk when the canonical root already exists", async () => {
    const existing = makeProject({
      id: projectIdFor("/canonical/cloud"),
      root: "/canonical/cloud",
    })
    const memento = seededMemento({ version: 1, projects: [existing] })
    const routing = new ProjectRouting(
      memento,
      () => factoryDeps(),
      () => {},
      fakeCanonicalRoot({ "/Users/me/code/cloud": "/canonical/cloud" }),
    )
    await routing.load()

    const result = await routing.addProject("/Users/me/code/cloud")
    if (!result.ok) throw new Error("expected ok")
    expect(result.deduplicated).toBe(true)
    expect(result.project.id).toBe(existing.id)
    expect(memento.read(PROJECT_REGISTRY_STORAGE_KEY)).toBe(JSON.stringify({ version: 1, projects: [existing] }))
  })

  test("addProject returns an unsupported_scheme error for vscode-vfs", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => factoryDeps())
    await routing.load()

    const result = await routing.addProject({ scheme: "vscode-vfs", path: "/virtual" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe("unsupported_scheme")
  })

  test("addProject returns a not_a_git_repo error for a folder outside any git tree", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(
      memento,
      () => factoryDeps(),
      () => {},
      async () => {
        const { NotAGitRepositoryError } = await import("../../src/agent-manager/project-canonical-root")
        throw new NotAGitRepositoryError("/Users/me/code/notgit")
      },
    )
    await routing.load()

    const result = await routing.addProject("/Users/me/code/notgit")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe("not_a_git_repo")
  })

  test("removeProject drops the entry from the registry and disposes its cached context", async () => {
    const project = makeProject({ id: "abc123456789def0" })
    const memento = seededMemento({ version: 1, projects: [project] })
    const routing = new ProjectRouting(memento, () => factoryDeps())
    await routing.load()

    routing.projectFor("abc123456789def0")
    expect(routing.snapshot().projects).toHaveLength(1)

    await routing.removeProject("abc123456789def0")
    expect(routing.snapshot().projects).toHaveLength(0)
    // Re-adding via projectFor should construct a fresh context.
    const ctx = routing.projectFor("abc123456789def0")
    expect(ctx).toBeUndefined()
  })

  test("removeProject clears activeProjectId when removing the active project", async () => {
    const project = makeProject({ id: "abc123456789def0" })
    const memento = seededMemento({ version: 1, projects: [project], activeProjectId: "abc123456789def0" })
    const routing = new ProjectRouting(memento, () => factoryDeps())
    await routing.load()

    await routing.removeProject("abc123456789def0")
    expect(routing.snapshot().activeProjectId).toBeUndefined()
  })

  test("removeProject preserves the activeProjectId when removing a different project", async () => {
    const a = makeProject({ id: "a", root: "/canonical/a" })
    const b = makeProject({ id: "b", root: "/canonical/b" })
    const memento = seededMemento({ version: 1, projects: [a, b], activeProjectId: "b" })
    const routing = new ProjectRouting(memento, () => factoryDeps())
    await routing.load()

    await routing.removeProject("a")
    expect(routing.snapshot().activeProjectId).toBe("b")
  })

  test("toggleProjectCollapsed flips the collapsed flag and persists", async () => {
    const project = makeProject({ id: "abc123456789def0", collapsed: false })
    const memento = seededMemento({ version: 1, projects: [project] })
    const routing = new ProjectRouting(memento, () => factoryDeps())
    await routing.load()

    await routing.toggleProjectCollapsed("abc123456789def0")
    expect(routing.getProject("abc123456789def0")?.collapsed).toBe(true)

    await routing.toggleProjectCollapsed("abc123456789def0")
    expect(routing.getProject("abc123456789def0")?.collapsed).toBe(false)
  })

  test("toggleProjectCollapsed honors an explicit collapsed override", async () => {
    const project = makeProject({ id: "abc123456789def0", collapsed: false })
    const memento = seededMemento({ version: 1, projects: [project] })
    const routing = new ProjectRouting(memento, () => factoryDeps())
    await routing.load()

    await routing.toggleProjectCollapsed("abc123456789def0", true)
    expect(routing.getProject("abc123456789def0")?.collapsed).toBe(true)

    await routing.toggleProjectCollapsed("abc123456789def0", false)
    expect(routing.getProject("abc123456789def0")?.collapsed).toBe(false)
  })

  test("toggleProjectCollapsed is a no-op for an unknown project", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => factoryDeps())
    await routing.load()

    const before = routing.snapshot()
    await routing.toggleProjectCollapsed("missing-id")
    expect(routing.snapshot()).toEqual(before)
  })

  test("parseFolderInput and validateFolder are exposed as seams for the provider", () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => factoryDeps())
    const folder = routing.parseFolderInput("/Users/me/code/cloud")
    expect(folder.scheme).toBe("file")
    const validated = routing.validateFolder(folder)
    expect(validated.candidate).toBe("/Users/me/code/cloud")
  })
})
