import { describe, expect, it } from "bun:test"
import { routeToolRequest } from "../../src/agent-manager/tool-project"

describe("Agent Manager tool project routing", () => {
  it("routes by the event directory before any explicit project id", () => {
    const secondary = { id: "prj-secondary" }
    const request = routeToolRequest({ requestID: "am-1", projectId: "prj-active", mode: "worktree" }, "/secondary", {
      byDirectory: (dir) => (dir === "/secondary" ? secondary : undefined),
      usable: () => ({ id: "prj-active" }),
    })

    expect(request.owner).toBe(secondary)
    expect(request.request).toEqual({
      requestID: "am-1",
      projectId: "prj-secondary",
      mode: "worktree",
      directory: "/secondary",
    })
  })

  it("uses an explicit usable project when no event directory is available", () => {
    const project = { id: "prj-secondary" }
    const request = routeToolRequest({ requestID: "am-2", projectId: "prj-secondary", mode: "local" }, undefined, {
      byDirectory: () => undefined,
      usable: (id) => (id === project.id ? project : undefined),
    })

    expect(request.owner).toBe(project)
    expect(request.request.projectId).toBe("prj-secondary")
  })
})
