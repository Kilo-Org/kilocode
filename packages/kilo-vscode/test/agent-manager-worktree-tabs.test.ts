import { describe, expect, it } from "bun:test"
import { worktreeSessionTabs } from "../webview-ui/agent-manager/project/session-filter"

const WORKTREE = "wt-one"
const OTHER = "wt-two"
const DIRECTORY = "/repo/.kilo/worktrees/one"

function session(id: string, created: number, parentID?: string) {
  return {
    id,
    parentID,
    title: id,
    location: { directory: DIRECTORY },
    time: { created, updated: created },
  }
}

const first = session("ses-one", 1)
const second = session("ses-two", 2)

function tabs(input: {
  managed?: { id: string; worktreeId: string }[]
  sessions?: unknown[]
  order?: string[]
  closed?: Set<string>
  owner?: (id: string) => string | null | undefined
}) {
  return worktreeSessionTabs({
    id: WORKTREE,
    managed: (input.managed ?? [
      { id: first.id, worktreeId: WORKTREE },
      { id: second.id, worktreeId: WORKTREE },
    ]) as never,
    sessions: (input.sessions ?? [first, second]) as never,
    order: input.order ?? [first.id, second.id],
    lookup: (id) => (id === first.id ? first : id === second.id ? second : undefined) as never,
    owner: input.owner ?? (() => WORKTREE),
    closed: input.closed,
  }).map((item) => item.id)
}

describe("worktreeSessionTabs", () => {
  it("lists the worktree's managed sessions in tab order", () => {
    expect(tabs({ order: [second.id, first.id] })).toEqual([second.id, first.id])
  })

  it("hides a closed session immediately while the host still files it and names it in the order", () => {
    expect(tabs({ closed: new Set([first.id]) })).toEqual([second.id])
    expect(tabs({ closed: new Set([first.id, second.id]) })).toEqual([])
  })

  it("drops a closed session that only the tab order names", () => {
    expect(
      tabs({
        managed: [],
        sessions: [first],
        order: [first.id],
        closed: new Set([first.id]),
      }),
    ).toEqual([])
  })

  it("keeps a session the host has not filed yet when the tab order names it here", () => {
    expect(
      tabs({
        managed: [{ id: first.id, worktreeId: WORKTREE }],
        sessions: [first, second],
        order: [first.id, second.id],
      }),
    ).toEqual([first.id, second.id])
  })

  it("does not add a session that runs in another worktree", () => {
    expect(
      tabs({
        managed: [],
        sessions: [first],
        order: [first.id],
        owner: () => OTHER,
      }),
    ).toEqual([])
  })

  it("keeps the remaining tabs in order after one closes", () => {
    expect(tabs({ closed: new Set([first.id]) })).toEqual([second.id])
    expect(tabs({ closed: new Set([second.id]) })).toEqual([first.id])
  })
})
