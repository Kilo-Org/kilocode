import { describe, expect, test } from "bun:test"
import type { VcsInfo } from "@kilocode/sdk/v2"
import { create } from "../../../../src/kilocode/cli/cmd/tui/branch-refresh"

function setup(input: {
  workspace?: string
  directory: string
  project: string
  branch?: string
  bootstrap?: boolean
}) {
  const state = {
    scope: { workspace: input.workspace, directory: input.directory, project: input.project },
    vcs: input.bootstrap === false ? undefined : ({ branch: input.branch, default_branch: "main" } as VcsInfo),
  }
  const calls: Array<{ workspace?: string; directory?: string }> = []
  const updates: VcsInfo[] = []
  const pending = Promise.withResolvers<{ data?: VcsInfo }>()
  const refresh = create({
    get: async (route) => {
      calls.push(route)
      return pending.promise
    },
    apply: (data) => {
      updates.push(data)
      state.vcs = data
    },
    scope: () => state.scope,
    ready: () => state.vcs !== undefined,
  })
  return { state, calls, updates, pending, refresh }
}

describe("TUI branch refresh", () => {
  test("waits for bootstrap and then applies the complete VCS snapshot", async () => {
    const value = setup({ directory: "/repo", project: "project", bootstrap: false })
    await value.refresh.refresh()
    expect(value.calls).toEqual([])
    expect(value.updates).toEqual([])

    value.state.vcs = { branch: "main", default_branch: "main" }
    const run = value.refresh.refresh()
    value.pending.resolve({ data: { branch: "feature", default_branch: "main" } })
    await run
    expect(value.state.vcs).toEqual({ branch: "feature", default_branch: "main" })
  })

  test("routes workspace refreshes and preserves the default branch", async () => {
    const value = setup({ workspace: "ws", directory: "/repo/ws", project: "project" })
    const run = value.refresh.refresh()
    expect(value.calls).toEqual([{ workspace: "ws" }])
    value.pending.resolve({ data: { branch: "feature", default_branch: "main" } })
    await run

    expect(value.updates).toEqual([{ branch: "feature", default_branch: "main" }])
  })

  test("routes directory refreshes without a workspace", async () => {
    const value = setup({ directory: "/repo", project: "project" })
    const run = value.refresh.refresh()
    expect(value.calls).toEqual([{ directory: "/repo" }])
    value.pending.resolve({ data: { branch: "feature", default_branch: "main" } })
    await run

    expect(value.updates).toHaveLength(1)
  })

  test("updates default branch metadata even when the current branch is unchanged", async () => {
    const value = setup({ directory: "/repo", project: "project", branch: "feature" })
    const run = value.refresh.refresh()
    value.pending.resolve({ data: { branch: "feature", default_branch: "develop" } })
    await run

    expect(value.state.vcs).toEqual({ branch: "feature", default_branch: "develop" })
  })

  test("ignores responses after the scope changes", async () => {
    const value = setup({ workspace: "ws-a", directory: "/repo/a", project: "project" })
    const run = value.refresh.refresh()
    value.state.scope = { workspace: "ws-b", directory: "/repo/b", project: "project" }
    value.pending.resolve({ data: { branch: "stale", default_branch: "main" } })
    await run

    expect(value.updates).toEqual([])
  })

  test("ignores responses after disposal", async () => {
    const value = setup({ directory: "/repo", project: "project" })
    const run = value.refresh.refresh()
    value.refresh.dispose()
    value.pending.resolve({ data: { branch: "stale", default_branch: "main" } })
    await run
    await value.refresh.refresh()

    expect(value.calls).toHaveLength(1)
    expect(value.updates).toEqual([])
  })

  test("keeps the current VCS snapshot when the response has no data", async () => {
    const value = setup({ directory: "/repo", project: "project", branch: "main" })
    const run = value.refresh.refresh()
    value.pending.resolve({})
    await run

    expect(value.state.vcs).toEqual({ branch: "main", default_branch: "main" })
    expect(value.updates).toEqual([])
  })
})
