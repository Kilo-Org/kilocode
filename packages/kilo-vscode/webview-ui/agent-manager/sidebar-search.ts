import type { SectionState } from "../src/types/messages/agent-manager"
import { strongest, type Activity } from "./v2/activity"

export type SidebarSearchState = Activity

type SearchItem = {
  key: string
  projectId?: string
  title: string
  meta: string[]
  search: string
  state: SidebarSearchState
  busy?: boolean
  visible: boolean
  section?: SectionState
}

export type SidebarSearchItem =
  | (SearchItem & {
      kind: "local"
      updatedAt: string
      group: "contexts"
      count: number
    })
  | (SearchItem & {
      kind: "worktree"
      updatedAt: string
      group: "contexts"
      worktreeId: string
      count: number
    })
  | (SearchItem & {
      kind: "session"
      updatedAt: string
      group: "sessions"
      sessionId: string
      location: "local" | "worktree"
      worktreeId?: string
    })
  | (SearchItem & { kind: "cloud"; group: "sessions"; selected: boolean })

/** Fold repeated observations (a context and its owning session) without counting the same work twice. */
export function projectActivity(rows: readonly Pick<SidebarSearchItem, "projectId" | "state">[]) {
  const states = new Map<string, Activity>()
  for (const row of rows) {
    if (row.projectId && row.state !== "idle")
      states.set(row.projectId, strongest([states.get(row.projectId) ?? "idle", row.state]))
  }
  return states
}
