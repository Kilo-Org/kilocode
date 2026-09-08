import { describe, expect, it } from "bun:test"
import { handleToolEvent, routeToolRequest } from "../../src/agent-manager/tool-project"

describe("Agent Manager tool project routing", () => {
  it("forwards the target in the caller's project scope", () => {
    const owner = { id: "prj-caller" }
    const calls: unknown[] = []
    handleToolEvent(
      { properties: { mode: "local", worktreeID: "wt-target", tasks: [{ name: "Prepared" }] } },
      "/caller",
      {
        byDirectory: (dir) => (dir === "/caller" ? owner : undefined),
        usable: () => undefined,
      },
      {
        run: async (project, fn) => {
          calls.push(project)
          return fn()
        },
      },
      async (req) => {
        calls.push(req)
      },
    )
    expect(calls).toEqual([
      owner,
      expect.objectContaining({ worktreeID: "wt-target", directory: "/caller", projectId: owner.id }),
    ])
  })
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
