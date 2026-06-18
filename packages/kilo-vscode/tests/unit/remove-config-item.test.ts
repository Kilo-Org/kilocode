import { describe, expect, it, mock } from "bun:test"
import { removeAgent, removeMcp, type RemoveConfigItemContext } from "../../src/kilo-provider/remove-config-item"

function context(opts: {
  project?: string
  remove: ReturnType<typeof mock>
  refresh: ReturnType<typeof mock>
}): RemoveConfigItemContext {
  return {
    connection: {
      getClientAsync: mock(async () => ({
        global: { config: { update: mock(async () => {}) } },
        instance: { dispose: mock(async () => {}) },
      })),
    } as unknown as RemoveConfigItemContext["connection"],
    project: () => opts.project,
    directory: () => "/repo",
    refresh: opts.refresh,
    remove: opts.remove,
  }
}

describe("remove config item adapter", () => {
  it("removes agents from project and global scopes, then refreshes", async () => {
    const remove = mock(async () => ({ success: true, slug: "reviewer" }))
    const refresh = mock(async () => {})
    const ctx = context({ project: "/repo", remove, refresh })

    expect(await removeAgent(ctx, "reviewer")).toBe(true)
    expect(remove).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenNthCalledWith(1, { id: "reviewer", type: "agent" }, "project", "/repo")
    expect(remove).toHaveBeenNthCalledWith(2, { id: "reviewer", type: "agent" }, "global", "/repo")
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("removes MCP servers globally when there is no project, then refreshes", async () => {
    const remove = mock(async () => ({ success: true, slug: "memory" }))
    const refresh = mock(async () => {})
    const ctx = context({ remove, refresh })

    expect(await removeMcp(ctx, "memory")).toBe(true)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith({ id: "memory", type: "mcp" }, "global", undefined)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("does not refresh when removal fails", async () => {
    const remove = mock(async () => ({ success: false, slug: "reviewer" }))
    const refresh = mock(async () => {})
    const ctx = context({ remove, refresh })

    expect(await removeAgent(ctx, "reviewer")).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })
})
