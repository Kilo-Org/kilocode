import { createMemo } from "solid-js"
import type { Accessor } from "solid-js"
import type { SectionState, SessionInfo, WorktreeState } from "../src/types/messages"
import { score, strongest, type Activity } from "../src/utils/session-activity"
import { LOCAL } from "./navigate"

export type SidebarSearchState = Activity

type SearchItem = {
  key: string
  projectId?: string
  title: string
  meta: string[]
  search: string
  updatedAt: string
  state: SidebarSearchState
  busy?: boolean
  visible: boolean
  section?: SectionState
}

export type SidebarSearchItem =
  | (SearchItem & {
      kind: "local"
      group: "contexts"
      count: number
    })
  | (SearchItem & {
      kind: "worktree"
      group: "contexts"
      worktreeId: string
      count: number
    })
  | (SearchItem & {
      kind: "session"
      group: "sessions"
      sessionId: string
      location: "local" | "worktree"
      worktreeId?: string
    })

export interface SidebarSearchWorktree {
  worktree: WorktreeState
  label: string
  sessions: SessionInfo[]
}

interface SidebarSearchInput {
  worktrees: SidebarSearchWorktree[]
  sections: SectionState[]
  local: SessionInfo[]
  localLabel: string
  localBranch?: string
  untitled: string
  pending: (id: string) => boolean
  activityFor: (id: string) => Activity
  busy: (id: string) => boolean
}

const root = (item: SessionInfo) => !item.parentID
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const newest = (items: SessionInfo[], fallback: string) =>
  items.reduce((latest, item) => (item.updatedAt > latest ? item.updatedAt : latest), fallback)

export function sortSidebarSearch(a: SidebarSearchItem, b: SidebarSearchItem) {
  return (
    score(b.state) - score(a.state) ||
    Number(b.visible) - Number(a.visible) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.title.localeCompare(b.title)
  )
}

export function buildSidebarSearch(input: SidebarSearchInput): SidebarSearchItem[] {
  const state = input.activityFor
  const sections = new Map(input.sections.map((item) => [item.id, item]))
  const owned = new Set(input.worktrees.flatMap((item) => item.sessions.map((session) => session.id)))
  const local = input.local.filter((session) => root(session) && !input.pending(session.id) && !owned.has(session.id))
  const sessions: SidebarSearchItem[] = local.map((session) => ({
    key: `session:${session.id}`,
    kind: "session" as const,
    group: "sessions" as const,
    title: session.title || input.untitled,
    meta: [input.localLabel],
    search: [session.title || input.untitled, input.localLabel, session.id].join(" "),
    sessionId: session.id,
    location: "local" as const,
    updatedAt: session.updatedAt,
    state: state(session.id),
    visible: true,
  }))
  const localState = strongest(local.map((session) => state(session.id)))
  const contexts: SidebarSearchItem[] = [
    {
      key: LOCAL,
      kind: "local",
      group: "contexts",
      title: input.localLabel,
      meta: input.localBranch ? [input.localBranch] : [],
      search: [input.localLabel, input.localBranch].filter(Boolean).join(" "),
      updatedAt: newest(local, ""),
      state: localState,
      visible: true,
      count: local.length,
    },
  ]

  for (const item of input.worktrees) {
    const wt = item.worktree
    const section = wt.sectionId ? sections.get(wt.sectionId) : undefined
    const roots = item.sessions.filter((session) => root(session) && !input.pending(session.id))

    for (const session of roots) {
      const title = session.title || input.untitled
      const meta = [section?.name, !same(item.label, title) ? item.label : undefined, wt.branch].filter(
        (value): value is string => !!value,
      )
      sessions.push({
        key: `session:${session.id}`,
        kind: "session",
        group: "sessions",
        title,
        meta,
        search: [title, item.label, wt.branch, section?.name, session.id].filter(Boolean).join(" "),
        sessionId: session.id,
        location: "worktree",
        worktreeId: wt.id,
        updatedAt: session.updatedAt,
        state: state(session.id),
        visible: !section?.collapsed,
        section,
      })
    }

    const context = strongest(roots.map((session) => state(session.id)))
    contexts.push({
      key: `worktree:${wt.id}`,
      kind: "worktree",
      group: "contexts",
      title: item.label,
      meta: [section?.name, wt.branch].filter((value): value is string => !!value),
      search: [item.label, wt.branch, section?.name, wt.prNumber ? `#${wt.prNumber}` : undefined, wt.id]
        .filter(Boolean)
        .join(" "),
      worktreeId: wt.id,
      updatedAt: newest(roots, wt.createdAt),
      state: context,
      busy: input.busy(wt.id),
      visible: !section?.collapsed,
      section,
      count: roots.length,
    })
  }

  // The List keeps this order for an empty query and as the tie-break order for equally relevant fuzzy matches.
  return [...sessions.sort(sortSidebarSearch), ...contexts.sort(sortSidebarSearch)]
}

interface SidebarSearchDeps {
  worktrees: Accessor<WorktreeState[]>
  sections: Accessor<SectionState[]>
  local: Accessor<SessionInfo[]>
  localBranch: Accessor<string | undefined>
  selection: Accessor<string | null>
  sessionId: Accessor<string | undefined>
  activityFor: (id: string) => Activity
  label: (worktree: WorktreeState) => string
  sessions: (id: string) => SessionInfo[]
  pending: (id: string) => boolean
  busy: (id: string) => boolean
  t: (key: string) => string
}

export function createSidebarSearch(deps: SidebarSearchDeps) {
  const items = createMemo(() => {
    return buildSidebarSearch({
      worktrees: deps.worktrees().map((worktree) => ({
        worktree,
        label: deps.label(worktree),
        sessions: deps.sessions(worktree.id),
      })),
      sections: deps.sections(),
      local: deps.local(),
      localLabel: deps.t("agentManager.local"),
      localBranch: deps.localBranch(),
      untitled: deps.t("agentManager.session.untitled"),
      pending: deps.pending,
      activityFor: deps.activityFor,
      busy: deps.busy,
    })
  })

  const current = createMemo(() => {
    const id = deps.sessionId()
    const selection = deps.selection()
    const active = items().find(
      (item) =>
        item.kind === "session" &&
        item.sessionId === id &&
        ((item.location === "local" && selection === LOCAL) || item.worktreeId === selection),
    )
    if (active || !selection) return active
    if (selection === LOCAL) return items().find((item) => item.kind === "local")
    return items().find((item) => item.kind === "worktree" && item.worktreeId === selection)
  })

  return { items, current }
}
