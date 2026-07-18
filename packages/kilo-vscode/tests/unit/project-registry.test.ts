import { describe, expect, test } from "bun:test"
import {
  parseProjectRegistry,
  serializeProjectRegistry,
  parseProject,
  serializeProject,
  UnknownProjectRegistryVersionError,
  InvalidProjectRegistryError,
  PROJECT_REGISTRY_VERSION,
  type Project,
  type ProjectRegistry,
} from "../../src/agent-manager/project-registry"

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "f64e3a9b8c1d2705",
    root: "/Users/me/code/kilocode",
    order: 0,
    collapsed: false,
    trusted: false,
    ...overrides,
  }
}

describe("project-registry", () => {
  test("round-trips an empty registry byte-equal", () => {
    const registry: ProjectRegistry = { version: PROJECT_REGISTRY_VERSION, projects: [] }
    const raw = serializeProjectRegistry(registry)
    expect(parseProjectRegistry(raw)).toEqual(registry)
  })

  test("round-trips a populated registry byte-equal", () => {
    const registry: ProjectRegistry = {
      version: PROJECT_REGISTRY_VERSION,
      activeProjectId: "f64e3a9b8c1d2705",
      projects: [
        makeProject({
          label: "kilocode",
          collapsed: true,
          trusted: true,
          trustedAt: "2026-07-18T10:00:00Z",
          lastActiveAt: "2026-07-18T11:00:00Z",
          lastSelectedContextId: "project:f64e3a9b8c1d2705:local",
          defaultBaseBranch: "main",
        }),
        makeProject({ id: "abc123456789def0", root: "/Users/me/code/cloud", order: 1, label: "cloud" }),
      ],
    }
    const serialized = serializeProjectRegistry(registry)
    const round = parseProjectRegistry(serialized)
    expect(round).toEqual(registry)
    expect(serializeProjectRegistry(round)).toBe(serialized)
  })

  test("preserves project order across a round-trip", () => {
    const registry: ProjectRegistry = {
      version: PROJECT_REGISTRY_VERSION,
      projects: [
        makeProject({ id: "1111111111111111", root: "/a", order: 0 }),
        makeProject({ id: "2222222222222222", root: "/b", order: 1 }),
        makeProject({ id: "3333333333333333", root: "/c", order: 2 }),
      ],
    }
    const round = parseProjectRegistry(serializeProjectRegistry(registry))
    expect(round.projects.map((p) => p.id)).toEqual(["1111111111111111", "2222222222222222", "3333333333333333"])
  })

  test("rejects an unknown registry version", () => {
    let caught: unknown
    try {
      parseProjectRegistry(JSON.stringify({ version: 99, projects: [] }))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(UnknownProjectRegistryVersionError)
  })

  test("rejects a registry missing the projects field", () => {
    let caught: unknown
    try {
      parseProjectRegistry(JSON.stringify({ version: PROJECT_REGISTRY_VERSION }))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(InvalidProjectRegistryError)
  })

  test("rejects malformed JSON", () => {
    let caught: unknown
    try {
      parseProjectRegistry("{invalid}")
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(InvalidProjectRegistryError)
  })

  test("rejects a registry with a non-string id", () => {
    let caught: unknown
    try {
      parseProjectRegistry(
        JSON.stringify({
          version: PROJECT_REGISTRY_VERSION,
          projects: [{ id: 42, root: "/a", order: 0, collapsed: false, trusted: false }],
        }),
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(InvalidProjectRegistryError)
  })

  test("parseProject / serializeProject round-trip a single project", () => {
    const project = makeProject({ label: "kilocode", trustedAt: "2026-07-18T10:00:00Z" })
    const raw = JSON.stringify(serializeProject(project))
    expect(parseProject(JSON.parse(raw))).toEqual(project)
  })
})
