import { describe, expect, test } from "bun:test"
import {
  resolveProjectRoot,
  ProjectUnknownError,
  type ProjectLookup,
} from "../../src/agent-manager/project-router"
import type { Project } from "../../src/agent-manager/project-registry"

function makeProject(id: string, root: string, partial: Partial<Project> = {}): Project {
  return {
    id,
    root,
    order: 0,
    collapsed: false,
    trusted: false,
    ...partial,
  }
}

function makeLookup(projects: Project[]): ProjectLookup {
  const map = new Map(projects.map((p) => [p.id, p]))
  return {
    get(id) {
      return map.get(id)
    },
  }
}

describe("resolveProjectRoot", () => {
  test("resolves to the project's root when the projectId matches a registered project", () => {
    const lookup = makeLookup([makeProject("abc123", "/Users/me/code/cloud")])
    expect(resolveProjectRoot(lookup, "abc123", "/Users/me/code/kilocode")).toEqual({
      kind: "project",
      projectId: "abc123",
      root: "/Users/me/code/cloud",
    })
  })

  test("falls back to the legacy workspaceFolders[0] root when projectId is absent", () => {
    const lookup = makeLookup([makeProject("abc123", "/Users/me/code/cloud")])
    expect(resolveProjectRoot(lookup, undefined, "/Users/me/code/kilocode")).toEqual({
      kind: "legacy",
      root: "/Users/me/code/kilocode",
    })
  })

  test("falls back to the legacy root when projectId is the empty string", () => {
    const lookup = makeLookup([makeProject("abc123", "/Users/me/code/cloud")])
    expect(resolveProjectRoot(lookup, "", "/Users/me/code/kilocode")).toEqual({
      kind: "legacy",
      root: "/Users/me/code/kilocode",
    })
  })

  test("rejects with ProjectUnknownError when projectId does not resolve and no legacy root is available", () => {
    const lookup = makeLookup([])
    expect(() => resolveProjectRoot(lookup, "missing-id", undefined)).toThrow(ProjectUnknownError)
  })

  test("ProjectUnknownError carries the supplied projectId", () => {
    try {
      resolveProjectRoot(makeLookup([]), "missing-id", undefined)
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectUnknownError)
      expect((err as ProjectUnknownError).projectId).toBe("missing-id")
      return
    }
    throw new Error("expected throw")
  })

  test("rejects with ProjectUnknownError when projectId does not resolve even if a legacy root exists (webview privilege check)", () => {
    const lookup = makeLookup([])
    expect(() => resolveProjectRoot(lookup, "ghost-id", "/Users/me/code/kilocode")).toThrow(ProjectUnknownError)
  })

  test("legacy root is rejected when undefined and no projectId supplied (no fallback to process.cwd())", () => {
    const lookup = makeLookup([])
    expect(() => resolveProjectRoot(lookup, undefined, undefined)).toThrow(ProjectUnknownError)
  })

  test("unrelated checks pass after removal of unused helper", () => {
    const lookup = makeLookup([])
    expect(lookup.get("missing")).toBeUndefined()
  })
})
