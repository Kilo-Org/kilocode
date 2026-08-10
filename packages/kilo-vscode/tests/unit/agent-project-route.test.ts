import { describe, expect, it } from "bun:test"
import { ProjectRouteError, ProjectRouteService } from "../../src/agent-manager/project/route"

describe("ProjectRouteService", () => {
  it("resolves explicit local, worktree, and session routes", () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerWorktree({ projectId: "a", worktreeId: "wt" }, "/repo/a/.kilo/wt", 1)
    routes.registerSession({ projectId: "a", sessionId: "local" }, "/repo/a", 1)
    routes.registerSession({ projectId: "a", sessionId: "work" }, "/repo/a/.kilo/wt", 1)
    expect(routes.projectRoot({ projectId: "a" })).toBe("/repo/a")
    expect(routes.worktreeDirectory({ projectId: "a", worktreeId: "wt" })).toBe("/repo/a/.kilo/wt")
    expect(routes.sessionDirectory({ projectId: "a", sessionId: "local" })).toBe("/repo/a")
    expect(routes.sessionDirectory({ projectId: "a", sessionId: "work" })).toBe("/repo/a/.kilo/wt")
  })

  it("inherits child session ownership", () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerSession({ projectId: "a", sessionId: "parent" }, "/repo/a", 1)
    routes.inheritSession({ projectId: "a", sessionId: "child" }, { projectId: "a", sessionId: "parent" })
    expect(routes.sessionDirectory({ projectId: "a", sessionId: "child" })).toBe("/repo/a")
  })

  it("detects ambiguous raw session ids", () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerProject("b", "/repo/b", 1)
    routes.registerSession({ projectId: "a", sessionId: "same" }, "/repo/a", 1)
    routes.registerSession({ projectId: "b", sessionId: "same" }, "/repo/b", 1)
    expect(() => routes.resolveRawSession("same")).toThrow(ProjectRouteError)
    try {
      routes.resolveRawSession("same")
    } catch (err) {
      expect((err as ProjectRouteError).code).toBe("session_ambiguous")
    }
  })

  it("invalidates routes when a project generation changes", () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerSession({ projectId: "a", sessionId: "s" }, "/repo/a", 1)
    routes.registerProject("a", "/repo/a", 2)
    expect(() => routes.sessionDirectory({ projectId: "a", sessionId: "s" })).toThrow(ProjectRouteError)
  })

  it("uses composite UI keys", () => {
    expect(ProjectRouteService.key({ projectId: "a", worktreeId: "same" })).not.toBe(
      ProjectRouteService.key({ projectId: "b", worktreeId: "same" }),
    )
  })

  describe("safe resolution (non-throwing)", () => {
    it("trySessionDirectory returns the exact dir for an unambiguous raw id", () => {
      const routes = new ProjectRouteService()
      routes.registerProject("a", "/repo/a", 1)
      routes.registerSession({ projectId: "a", sessionId: "s1" }, "/repo/a", 1)
      expect(routes.trySessionDirectory("s1")).toBe("/repo/a")
    })

    it("trySessionDirectory returns undefined for an unknown raw id", () => {
      const routes = new ProjectRouteService()
      routes.registerProject("a", "/repo/a", 1)
      expect(routes.trySessionDirectory("missing")).toBeUndefined()
    })

    it("trySessionDirectory returns undefined for an ambiguous raw id (never picks one)", () => {
      const routes = new ProjectRouteService()
      routes.registerProject("a", "/repo/a", 1)
      routes.registerProject("b", "/repo/b", 1)
      routes.registerSession({ projectId: "a", sessionId: "same" }, "/repo/a", 1)
      routes.registerSession({ projectId: "b", sessionId: "same" }, "/repo/b", 1)
      expect(routes.trySessionDirectory("same")).toBeUndefined()
    })

    it("isSessionAmbiguous is true only when a raw id maps to more than one project", () => {
      const routes = new ProjectRouteService()
      routes.registerProject("a", "/repo/a", 1)
      routes.registerProject("b", "/repo/b", 1)
      routes.registerSession({ projectId: "a", sessionId: "same" }, "/repo/a", 1)
      expect(routes.isSessionAmbiguous("same")).toBe(false)
      routes.registerSession({ projectId: "b", sessionId: "same" }, "/repo/b", 1)
      expect(routes.isSessionAmbiguous("same")).toBe(true)
      expect(routes.isSessionAmbiguous("unknown")).toBe(false)
    })

    it("trySessionDirectoryFor resolves a project-qualified ref exactly", () => {
      const routes = new ProjectRouteService()
      routes.registerProject("a", "/repo/a", 1)
      routes.registerProject("b", "/repo/b", 1)
      routes.registerSession({ projectId: "a", sessionId: "same" }, "/repo/a", 1)
      routes.registerSession({ projectId: "b", sessionId: "same" }, "/repo/b", 1)
      expect(routes.trySessionDirectoryFor({ projectId: "a", sessionId: "same" })).toBe("/repo/a")
      expect(routes.trySessionDirectoryFor({ projectId: "b", sessionId: "same" })).toBe("/repo/b")
    })

    it("trySessionDirectoryFor returns undefined for an unknown project or session", () => {
      const routes = new ProjectRouteService()
      routes.registerProject("a", "/repo/a", 1)
      routes.registerSession({ projectId: "a", sessionId: "s1" }, "/repo/a", 1)
      expect(routes.trySessionDirectoryFor({ projectId: "nope", sessionId: "s1" })).toBeUndefined()
      expect(routes.trySessionDirectoryFor({ projectId: "a", sessionId: "missing" })).toBeUndefined()
    })

    it("unregisterSession removes one route and clears ambiguity", () => {
      const routes = new ProjectRouteService()
      routes.registerProject("a", "/repo/a", 1)
      routes.registerProject("b", "/repo/b", 1)
      routes.registerSession({ projectId: "a", sessionId: "same" }, "/repo/a", 1)
      routes.registerSession({ projectId: "b", sessionId: "same" }, "/repo/b", 1)
      expect(routes.isSessionAmbiguous("same")).toBe(true)
      routes.unregisterSession({ projectId: "b", sessionId: "same" })
      expect(routes.isSessionAmbiguous("same")).toBe(false)
      expect(routes.trySessionDirectory("same")).toBe("/repo/a")
    })

    it("unregisterSession is a no-op for an unknown ref", () => {
      const routes = new ProjectRouteService()
      routes.registerProject("a", "/repo/a", 1)
      expect(() => routes.unregisterSession({ projectId: "a", sessionId: "missing" })).not.toThrow()
    })

    it("hasSession reports registered refs only", () => {
      const routes = new ProjectRouteService()
      routes.registerProject("a", "/repo/a", 1)
      routes.registerSession({ projectId: "a", sessionId: "s1" }, "/repo/a", 1)
      expect(routes.hasSession({ projectId: "a", sessionId: "s1" })).toBe(true)
      expect(routes.hasSession({ projectId: "a", sessionId: "s2" })).toBe(false)
    })

    it("unregisterProject clears all session routes for that project", () => {
      const routes = new ProjectRouteService()
      routes.registerProject("a", "/repo/a", 1)
      routes.registerSession({ projectId: "a", sessionId: "s1" }, "/repo/a", 1)
      routes.registerSession({ projectId: "a", sessionId: "s2" }, "/repo/a", 1)
      routes.unregisterProject("a")
      expect(routes.trySessionDirectory("s1")).toBeUndefined()
      expect(routes.trySessionDirectory("s2")).toBeUndefined()
      expect(routes.isSessionAmbiguous("s1")).toBe(false)
    })
  })
})
