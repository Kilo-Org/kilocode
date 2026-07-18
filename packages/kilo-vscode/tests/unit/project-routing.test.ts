import { describe, expect, test } from "bun:test"
import { PROJECT_REGISTRY_STORAGE_KEY } from "../../src/agent-manager/project-registry-store"
import { ProjectRouting } from "../../src/agent-manager/project-routing"
import { projectIdFor } from "../../src/agent-manager/project-id"
import { type Project } from "../../src/agent-manager/project-registry"
import { ProjectUnknownError } from "../../src/agent-manager/project-router"
import type { ProjectContextDeps } from "../../src/agent-manager/project-context"
import { makeMemento } from "./_helpers/memento"

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: projectIdFor("/Users/me/code/kilocode"),
    root: "/Users/me/code/kilocode",
    order: 0,
    collapsed: false,
    trusted: false,
    ...overrides,
  }
}

function seeded(registry: unknown) {
  const m = makeMemento()
  m.seed({ [PROJECT_REGISTRY_STORAGE_KEY]: JSON.stringify(registry) })
  return m
}

describe("ProjectRouting", () => {
  test("load reads the persisted registry from globalState", async () => {
    const project = makeProject({ id: "abc123456789def0" })
    const memento = seeded({ version: 1, projects: [project], activeProjectId: project.id })
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()
    expect(routing.getProject("abc123456789def0")?.root).toBe("/Users/me/code/kilocode")
  })

  test("load swallows corrupt payloads (recovery prompt lives in a later ticket) and logs the error", async () => {
    const memento = makeMemento()
    memento.seed({ [PROJECT_REGISTRY_STORAGE_KEY]: "{not-json" })
    const logs: string[] = []
    const routing = new ProjectRouting(memento, () => makeFactoryDeps(), (msg) => logs.push(msg))
    await routing.load()
    expect(routing.snapshot()).toEqual({ version: 1, projects: [] })
    expect(logs.length).toBeGreaterThan(0)
  })

  test("resolveRoot uses the project's root when projectId resolves", async () => {
    const project = makeProject({ id: "abc123456789def0", root: "/Users/me/code/cloud" })
    const memento = seeded({ version: 1, projects: [project] })
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    expect(routing.resolveRoot("abc123456789def0", "/Users/me/code/kilocode")).toEqual({
      kind: "project",
      projectId: "abc123456789def0",
      root: "/Users/me/code/cloud",
    })
  })

  test("resolveRoot uses the legacy root when projectId is absent", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    expect(routing.resolveRoot(undefined, "/Users/me/code/kilocode")).toEqual({
      kind: "legacy",
      root: "/Users/me/code/kilocode",
    })
  })

  test("resolveRoot uses the legacy root when projectId is the empty string", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    expect(routing.resolveRoot("", "/legacy")).toEqual({ kind: "legacy", root: "/legacy" })
  })

  test("resolveRoot throws ProjectUnknownError when projectId does not resolve", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    expect(() => routing.resolveRoot("missing-id", "/legacy")).toThrow(ProjectUnknownError)
  })

  test("resolveRoot throws when neither projectId nor legacy root is set", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    expect(() => routing.resolveRoot(undefined, undefined)).toThrow(ProjectUnknownError)
  })

  test("projectFor lazily constructs and caches a ProjectContext for a registered project", async () => {
    let factoryCalls = 0
    const project = makeProject({ id: "abc123456789def0", root: "/Users/me/code/cloud" })
    const memento = seeded({ version: 1, projects: [project] })
    const routing = new ProjectRouting(memento, () => {
      factoryCalls += 1
      return makeFactoryDeps()
    })
    await routing.load()

    const first = routing.projectFor("abc123456789def0")
    const second = routing.projectFor("abc123456789def0")
    expect(first).toBeDefined()
    expect(second).toBe(first)
    expect(factoryCalls).toBe(1)
  })

  test("projectFor returns undefined for an unknown project id", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()
    expect(routing.projectFor("nope")).toBeUndefined()
  })

  test("disposeProject clears the cached context (factory called again on next projectFor)", async () => {
    let factoryCalls = 0
    const project = makeProject({ id: "abc123456789def0", root: "/Users/me/code/cloud" })
    const memento = seeded({ version: 1, projects: [project] })
    const routing = new ProjectRouting(memento, () => {
      factoryCalls += 1
      return makeFactoryDeps()
    })
    await routing.load()

    const first = routing.projectFor("abc123456789def0")
    routing.disposeProject("abc123456789def0")
    const second = routing.projectFor("abc123456789def0")
    expect(second).not.toBe(first)
    expect(factoryCalls).toBe(2)
  })

  test("disposeAll clears every cached context but does not touch the registry", async () => {
    let factoryCalls = 0
    const project = makeProject({ id: "abc123456789def0" })
    const memento = seeded({ version: 1, projects: [project] })
    const routing = new ProjectRouting(memento, () => {
      factoryCalls += 1
      return makeFactoryDeps()
    })
    await routing.load()

    const first = routing.projectFor("abc123456789def0")
    routing.disposeAll()
    const second = routing.projectFor("abc123456789def0")
    expect(second).not.toBe(first)
    expect(factoryCalls).toBe(2)
    expect(routing.getProject("abc123456789def0")?.id).toBe("abc123456789def0")
  })

  test("load is idempotent across repeated calls", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await Promise.all([routing.load(), routing.load(), routing.load()])
    expect(routing.snapshot()).toEqual({ version: 1, projects: [] })
  })
})

function makeFactoryDeps(): ProjectContextDeps {
  return {
    buildWorktreeManager: () => ({ placeholder: true }),
  }
}
