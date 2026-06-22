import { describe, expect, it } from "bun:test"
import type { SectionState, SessionInfo, WorktreeState } from "../../webview-ui/src/types/messages"
import { buildSidebarSearch } from "../../webview-ui/agent-manager/sidebar-search"
import { buildShortcutCategories } from "../../webview-ui/agent-manager/shortcuts"

const session = (id: string, title: string, updatedAt: string, parentID?: string): SessionInfo => ({
  id,
  title,
  parentID,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt,
})

const worktree = (id: string, branch: string, sectionId?: string): WorktreeState => ({
  id,
  branch,
  path: `/tmp/${id}`,
  parentBranch: "main",
  createdAt: "2026-06-01T00:00:00.000Z",
  sectionId,
})

const section: SectionState = {
  id: "section-polish",
  name: "Polish",
  color: "Blue",
  order: 0,
  collapsed: true,
}

const build = (overrides?: Partial<Parameters<typeof buildSidebarSearch>[0]>) =>
  buildSidebarSearch({
    worktrees: [
      {
        worktree: worktree("wt-search", "feat/sidebar-search", section.id),
        label: "Agent Manager search",
        sessions: [
          session("busy-session", "Build grouped search", "2026-06-02T00:00:00.000Z"),
          session("recent-session", "Review search UI", "2026-06-03T00:00:00.000Z"),
        ],
      },
      {
        worktree: worktree("wt-other", "fix/other"),
        label: "Other worktree",
        sessions: [session("other-session", "Other session", "2026-06-04T00:00:00.000Z")],
      },
    ],
    sections: [section],
    local: [session("local-session", "Local investigation", "2026-06-05T00:00:00.000Z")],
    localLabel: "local",
    localBranch: "main",
    untitled: "Untitled",
    pending: (id) => id.startsWith("pending:"),
    status: (id) => (id === "busy-session" ? "busy" : "idle"),
    busy: () => false,
    localBusy: false,
    ...overrides,
  })

describe("buildSidebarSearch", () => {
  it("indexes worktree sessions with section context and excludes non-root tabs", () => {
    const items = build({
      worktrees: [
        {
          worktree: worktree("wt-search", "feat/sidebar-search", section.id),
          label: "Agent Manager search",
          sessions: [
            session("session", "Build grouped search", "2026-06-02T00:00:00.000Z"),
            session("pending:1", "New Session", "2026-06-03T00:00:00.000Z"),
            session("child", "Subagent", "2026-06-04T00:00:00.000Z", "session"),
          ],
        },
      ],
      local: [],
    })

    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      kind: "session",
      sessionId: "session",
      worktreeId: "wt-search",
      meta: ["Polish", "Agent Manager search", "feat/sidebar-search"],
      section: { id: section.id, color: "Blue", collapsed: true },
    })
    expect(items[0]?.search).toContain("Build grouped search Agent Manager search feat/sidebar-search Polish")
    expect(items[1]).toMatchObject({ kind: "local", title: "local", meta: ["main"], count: 0 })
    expect(items[2]).toMatchObject({ kind: "worktree", worktreeId: "wt-search", count: 1, visible: false })
  })

  it("ranks attention and progress before recency within each result group", () => {
    const items = build()

    expect(items.map((item) => item.key)).toEqual([
      "session:busy-session",
      "session:local-session",
      "session:other-session",
      "session:recent-session",
      "worktree:wt-search",
      "local",
      "worktree:wt-other",
    ])
    expect(items[0]).toMatchObject({ state: "busy", updatedAt: "2026-06-02T00:00:00.000Z" })
    expect(items[1]).toMatchObject({ location: "local", meta: ["local"] })
    expect(items[4]).toMatchObject({ state: "busy", updatedAt: "2026-06-03T00:00:00.000Z" })
  })

  it("uses expanded sidebar visibility before recency as a tie-breaker", () => {
    const items = build({
      worktrees: [
        {
          worktree: worktree("wt-hidden", "feat/hidden", section.id),
          label: "Same task hidden",
          sessions: [session("hidden", "Same task", "2026-06-05T00:00:00.000Z")],
        },
        {
          worktree: worktree("wt-visible", "feat/visible"),
          label: "Same task visible",
          sessions: [session("visible", "Same task", "2026-06-01T00:00:00.000Z")],
        },
      ],
      local: [],
      status: () => "idle",
    })

    expect(items.filter((item) => item.kind === "session").map((item) => item.sessionId)).toEqual(["visible", "hidden"])
    expect(items.find((item) => item.key === "session:hidden")).toMatchObject({ visible: false })
    expect(items.find((item) => item.key === "session:visible")).toMatchObject({ visible: true })
  })

  it("avoids repeating a worktree label that matches the session title", () => {
    const items = build({
      worktrees: [
        {
          worktree: worktree("wt-owned", "feat/owned", section.id),
          label: "Owned context",
          sessions: [session("owned", "Owned context", "2026-06-02T00:00:00.000Z")],
        },
      ],
      local: [],
    })

    expect(items[0]).toMatchObject({ kind: "session", meta: ["Polish", "feat/owned"] })
  })
})

describe("Agent Manager shortcut map", () => {
  it("includes sidebar search in the quick-switch section", () => {
    const categories = buildShortcutCategories({ search: "⌘F", jumpTo1: "⌘1" }, (key) => key)
    expect(categories[0]?.shortcuts[0]).toEqual({
      label: "agentManager.sidebarSearch.label",
      binding: "⌘F",
    })
  })

  it("includes open pull request in the sidebar section", () => {
    const categories = buildShortcutCategories({ openPR: "⌘⇧R" }, (key) => key)
    expect(categories[1]?.shortcuts).toContainEqual({
      label: "agentManager.shortcuts.openPR",
      binding: "⌘⇧R",
    })
  })
})
