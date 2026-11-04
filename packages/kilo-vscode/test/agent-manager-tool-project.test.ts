import { describe, expect, it } from "bun:test"
import { handleToolEvent, routeToolRequest } from "../src/agent-manager/tool-project"

describe("Agent Manager tool project routing", () => {
  it("forwards the target in the caller's project scope", () => {
    const owner = { id: "prj-caller" }
    const calls: unknown[] = []
    handleToolEvent(
      { data: { mode: "local", worktreeID: "wt-target", tasks: [{ name: "Prepared" }] } },
      "/caller",
      {
        byDirectory: (dir) => (dir === "/caller" ? owner : undefined),
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
    expect(calls).toEqual([owner, expect.objectContaining({ worktreeID: "wt-target", directory: "/caller" })])
  })

  it("routes by the event directory", () => {
    const secondary = { id: "prj-secondary" }
    const request = routeToolRequest({ requestID: "am-1", mode: "worktree" }, "/secondary", {
      byDirectory: (dir) => (dir === "/secondary" ? secondary : undefined),
    })

    expect(request.owner).toBe(secondary)
    expect(request.request).toEqual({
      requestID: "am-1",
      mode: "worktree",
      directory: "/secondary",
    })
  })

  it("starts without a scope when the event directory has no project", () => {
    const calls: unknown[] = []
    handleToolEvent(
      { data: { requestID: "am-2", mode: "local", tasks: [{ prompt: "Fix" }] } },
      undefined,
      { byDirectory: () => undefined },
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
    expect(calls).toEqual([expect.objectContaining({ requestID: "am-2", mode: "local" })])
  })
})