import { describe, expect, test } from "bun:test"
import { createSharedGitStats, type GitChanges } from "../src/git-changes"
import type { GitChangesStats } from "../src/protocol"

function fakePoller(publish?: (stats: GitChangesStats | undefined) => void) {
  const state: {
    visible: boolean[]
    disposed: boolean
    publish?: (stats: GitChangesStats | undefined) => void
  } = { visible: [], disposed: false, publish }
  const source: GitChanges = {
    read: async () => undefined,
    setVisible: (next) => state.visible.push(next),
    dispose: () => {
      state.disposed = true
    },
  }
  return { state, source }
}

describe("shared git stats", () => {
  test("one poller serves every surface, and reports reach all of them", () => {
    const created: ReturnType<typeof fakePoller>[] = []
    const stats = createSharedGitStats({
      directory: "/repo",
      create: (input) => {
        const poller = fakePoller(input.onStats)
        created.push(poller)
        return poller.source
      },
    })
    const first: Array<GitChangesStats | undefined> = []
    const second: Array<GitChangesStats | undefined> = []
    const a = stats((value) => first.push(value))
    const b = stats((value) => second.push(value))

    a.setVisible(true)
    b.setVisible(true)
    expect(created).toHaveLength(1)
    expect(created[0]?.state.visible).toEqual([true])

    created[0]?.state.publish?.({ files: 2, additions: 5, deletions: 1 })
    expect(first).toEqual([{ files: 2, additions: 5, deletions: 1 }])
    expect(second).toEqual([{ files: 2, additions: 5, deletions: 1 }])
  })

  test("the poller runs while any surface is visible", () => {
    const created: ReturnType<typeof fakePoller>[] = []
    const stats = createSharedGitStats({
      directory: "/repo",
      create: (input) => {
        const poller = fakePoller(input.onStats)
        created.push(poller)
        return poller.source
      },
    })
    const a = stats(() => {})
    const b = stats(() => {})
    a.setVisible(true)
    b.setVisible(true)
    expect(created[0]?.state.visible).toEqual([true])
    a.setVisible(false)
    expect(created[0]?.state.visible).toEqual([true])
    b.setVisible(false)
    expect(created[0]?.state.visible).toEqual([true, false])
  })

  test("the last disposal stops the poller, and the next surface starts a fresh one", () => {
    const created: ReturnType<typeof fakePoller>[] = []
    const stats = createSharedGitStats({
      directory: "/repo",
      create: (input) => {
        const poller = fakePoller(input.onStats)
        created.push(poller)
        return poller.source
      },
    })
    const a = stats(() => {})
    const b = stats(() => {})
    a.setVisible(true)
    b.setVisible(true)
    a.dispose()
    expect(created[0]?.state.disposed).toBe(false)
    b.dispose()
    expect(created[0]?.state.disposed).toBe(true)

    const c = stats(() => {})
    c.setVisible(true)
    expect(created).toHaveLength(2)
    expect(created[1]?.state.visible).toEqual([true])
  })
})
