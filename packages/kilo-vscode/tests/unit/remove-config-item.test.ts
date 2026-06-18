import { describe, expect, it, mock } from "bun:test"
import { removeAgent, removeMcp, type RemoveConfigItemContext } from "../../src/kilo-provider/remove-config-item"

function context(opts: {
  project?: string
  uninstall: ReturnType<typeof mock>
  refresh: ReturnType<typeof mock>
}): RemoveConfigItemContext {
  return {
    connection: {
      getClientAsync: mock(async () => ({
        global: { config: { update: mock(async () => {}) } },
        instance: { dispose: mock(async () => {}) },
        kilocode: { marketplace: { uninstall: opts.uninstall } },
      })),
    } as unknown as RemoveConfigItemContext["connection"],
    project: () => opts.project,
    directory: () => "/repo",
    refresh: opts.refresh,
  }
}

describe("remove config item adapter", () => {
  it("removes agents from project and global scopes, then refreshes", async () => {
    const uninstall = mock(async () => ({ data: { success: true, slug: "reviewer" } }))
    const refresh = mock(async () => {})
    const ctx = context({ project: "/repo", uninstall, refresh })

    expect(await removeAgent(ctx, "reviewer")).toBe(true)
    expect(uninstall).toHaveBeenCalledTimes(2)
    expect(uninstall).toHaveBeenNthCalledWith(
      1,
      { id: "reviewer", type: "agent", target: "project", directory: "/repo" },
      { throwOnError: true },
    )
    expect(uninstall).toHaveBeenNthCalledWith(
      2,
      { id: "reviewer", type: "agent", target: "global", directory: "/repo" },
      { throwOnError: true },
    )
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("removes MCP servers globally when there is no project, then refreshes", async () => {
    const uninstall = mock(async () => ({ data: { success: true, slug: "memory" } }))
    const refresh = mock(async () => {})
    const ctx = context({ uninstall, refresh })

    expect(await removeMcp(ctx, "memory")).toBe(true)
    expect(uninstall).toHaveBeenCalledTimes(1)
    expect(uninstall).toHaveBeenCalledWith(
      { id: "memory", type: "mcp", target: "global", directory: "/repo" },
      { throwOnError: true },
    )
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("does not refresh when removal fails", async () => {
    const uninstall = mock(async () => ({ data: { success: false, slug: "reviewer" } }))
    const refresh = mock(async () => {})
    const ctx = context({ uninstall, refresh })

    expect(await removeAgent(ctx, "reviewer")).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })
})
