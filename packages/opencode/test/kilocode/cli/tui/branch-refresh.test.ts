import { describe, expect, test } from "bun:test"
import { create } from "../../../../src/kilocode/cli/cmd/tui/branch-refresh"

function setup(input: { workspace?: string; directory: string; project: string; branch?: string }) {
  const state = {
    scope: { workspace: input.workspace, directory: input.directory, project: input.project },
    branch: input.branch,
  }
  const calls: Array<{ workspace?: string; directory?: string }> = []
  const events: unknown[] = []
  const pending = Promise.withResolvers<{ data?: { branch?: string } }>()
  const refresh = create({
    get: async (route) => {
      calls.push(route)
      return pending.promise
    },
    emit: (_, event) => {
      events.push(event)
      state.branch = event.payload.type === "vcs.branch.updated" ? event.payload.properties.branch : state.branch
    },
    scope: () => state.scope,
    branch: () => state.branch,
  })
  return { state, calls, events, pending, refresh }
}

describe("TUI branch refresh", () => {
  test("routes workspace refreshes and emits the scoped branch event", async () => {
    const value = setup({ workspace: "ws", directory: "/repo/ws", project: "project" })
    const run = value.refresh.refresh()
    expect(value.calls).toEqual([{ workspace: "ws" }])
    value.pending.resolve({ data: { branch: "feature" } })
    await run

    expect(value.events).toEqual([
      {
        directory: "/repo/ws",
        project: "project",
        workspace: "ws",
        payload: {
          id: expect.stringMatching(/^vcs-refresh-/),
          type: "vcs.branch.updated",
          properties: { branch: "feature" },
        },
      },
    ])
  })

  test("routes directory refreshes without a workspace", async () => {
    const value = setup({ directory: "/repo", project: "project" })
    const run = value.refresh.refresh()
    expect(value.calls).toEqual([{ directory: "/repo" }])
    value.pending.resolve({ data: { branch: "feature" } })
    await run

    expect(value.events).toHaveLength(1)
  })

  test("ignores responses after the scope changes", async () => {
    const value = setup({ workspace: "ws-a", directory: "/repo/a", project: "project" })
    const run = value.refresh.refresh()
    value.state.scope = { workspace: "ws-b", directory: "/repo/b", project: "project" }
    value.pending.resolve({ data: { branch: "stale" } })
    await run

    expect(value.events).toEqual([])
  })

  test("ignores responses after disposal", async () => {
    const value = setup({ directory: "/repo", project: "project" })
    const run = value.refresh.refresh()
    value.refresh.dispose()
    value.pending.resolve({ data: { branch: "stale" } })
    await run
    await value.refresh.refresh()

    expect(value.calls).toHaveLength(1)
    expect(value.events).toEqual([])
  })

  test("keeps the current branch when the response has no data", async () => {
    const value = setup({ directory: "/repo", project: "project", branch: "main" })
    const run = value.refresh.refresh()
    value.pending.resolve({})
    await run

    expect(value.state.branch).toBe("main")
    expect(value.events).toEqual([])
  })

  test("uses distinct event IDs across controller lifetimes", async () => {
    const events: string[] = []
    for (let index = 0; index < 2; index++) {
      const refresh = create({
        get: async () => ({ data: { branch: "main" } }),
        emit: (_, event) => events.push(event.payload.id),
        scope: () => ({ directory: "/repo", project: "project" }),
        branch: () => undefined,
      })
      await refresh.refresh()
      refresh.dispose()
    }
    expect(new Set(events).size).toBe(2)
  })
})
