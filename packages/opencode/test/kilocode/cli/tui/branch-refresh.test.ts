import { describe, expect, test } from "bun:test"
import type { VcsInfo } from "@kilocode/sdk/v2"
import { create } from "../../../../src/kilocode/cli/cmd/tui/branch-refresh"

function setup(workspace?: string) {
  const state = {
    scope: { workspace, directory: "/repo", project: "project" },
    vcs: { branch: "main", default_branch: "main" } as VcsInfo | undefined,
  }
  const calls: Array<{ workspace?: string; directory?: string }> = []
  const pending = Promise.withResolvers<{ data?: VcsInfo }>()
  const refresh = create({
    get: async (route) => {
      calls.push(route)
      return pending.promise
    },
    apply: (data) => (state.vcs = data),
    scope: () => state.scope,
    ready: () => state.vcs !== undefined,
  })
  return { state, calls, pending, refresh }
}

describe("TUI branch refresh", () => {
  test("waits for bootstrap and then applies the complete VCS snapshot", async () => {
    const value = setup()
    value.state.vcs = undefined
    await value.refresh.refresh()
    expect(value.calls).toEqual([])

    value.state.vcs = { branch: "main", default_branch: "main" }
    const run = value.refresh.refresh()
    value.pending.resolve({ data: { branch: "feature", default_branch: "main" } })
    await run
    expect(value.state.vcs).toEqual({ branch: "feature", default_branch: "main" })
  })

  test.each(["ws", undefined])(
    "routes %s refreshes and updates metadata when the branch is unchanged",
    async (workspace) => {
      const value = setup(workspace)
      const run = value.refresh.refresh()
      expect(value.calls).toEqual([workspace ? { workspace } : { directory: "/repo" }])
      value.pending.resolve({ data: { branch: "main", default_branch: "develop" } })
      await run
      expect(value.state.vcs).toEqual({ branch: "main", default_branch: "develop" })
    },
  )

  test("ignores responses after the scope changes", async () => {
    const value = setup("ws-a")
    const run = value.refresh.refresh()
    value.state.scope = { workspace: "ws-b", directory: "/repo/b", project: "project" }
    value.pending.resolve({ data: { branch: "stale", default_branch: "main" } })
    await run
    expect(value.state.vcs).toEqual({ branch: "main", default_branch: "main" })
  })

  test("ignores responses after disposal", async () => {
    const value = setup()
    const run = value.refresh.refresh()
    value.refresh.dispose()
    value.pending.resolve({ data: { branch: "stale", default_branch: "main" } })
    await run
    await value.refresh.refresh()
    expect(value.calls).toHaveLength(1)
    expect(value.state.vcs).toEqual({ branch: "main", default_branch: "main" })
  })

  test("keeps the current VCS snapshot when the response has no data", async () => {
    const value = setup()
    const run = value.refresh.refresh()
    value.pending.resolve({})
    await run
    expect(value.state.vcs).toEqual({ branch: "main", default_branch: "main" })
  })
})
