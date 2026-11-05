import type {
  AgentManagerStateMessage,
  AgentProjectSnapshot,
  LocalGitStats,
  PRStatus,
  SectionState,
  WorktreeGitStats,
  WorktreeState,
} from "../../src/types/messages"
import type { Activity } from "../../src/utils/session-activity"
import type { Example, Row, Session } from "./examples"

const status = {
  working: "busy",
  finished: "done",
  "needs-you": "waiting",
} satisfies Record<NonNullable<Session["status"]>, Activity>

/** Sidebar ids for fixture rows. `fleet()` and `rowId()` share it so markers always match real rows. */
function ids(example: Example, project: string) {
  const id = `splash:${example.id}:${project}`
  return {
    project: id,
    section: (section: string) => `${id}:section:${section}`,
    group: (group: string) => `${id}:group:${group}`,
    worktree: (session: string) => `${id}:worktree:${session}`,
  }
}

/** The sidebar id a feature's row renders with. */
export function rowId(example: Example, row: Row) {
  const id = ids(example, row.project)
  if (row.kind === "project") return id.project
  if (row.kind === "section") return id.section(row.section)
  if (row.kind === "group") return id.group(row.group)
  return id.worktree(row.session)
}

/** Adapt splash fixtures to the same data consumed by the live project sidebar. */
export function fleet(example: Example) {
  return example.fixture.projects.map((fixture, index) => {
    const id = ids(example, fixture.id)
    const worktrees: WorktreeState[] = []
    const sections: SectionState[] = []
    const order: string[] = []
    const stats: Record<string, WorktreeGitStats> = {}
    const prs: Record<string, PRStatus> = {}
    const activity: Record<string, Activity> = {}
    const selected: string[] = []
    const local: LocalGitStats = {
      branch: fixture.rows.find((row) => row.kind === "local")?.branch ?? "main",
      files: 0,
      additions: 0,
      deletions: 0,
      ahead: 0,
      behind: 0,
    }
    const add = (session: Session, section?: string, group?: string) => {
      const key = id.worktree(session.id)
      worktrees.push({
        id: key,
        label: session.title,
        branch: session.branch ?? session.note ?? session.title,
        path: `${fixture.name}/.kilo/worktrees/${key}`,
        parentBranch: local.branch,
        createdAt: "2026-01-01T00:00:00.000Z",
        sectionId: section,
        groupId: group,
      })
      order.push(key)
      stats[key] = {
        worktreeId: key,
        files: 0,
        additions: session.diff?.additions ?? 0,
        deletions: session.diff?.deletions ?? 0,
        ahead: 0,
        behind: 0,
      }
      activity[key] = session.status ? status[session.status] : "idle"
      if (session.selected) selected.push(key)
      if (session.pr) {
        prs[key] = {
          number: session.pr,
          title: session.title,
          url: "",
          state: "open",
          review: "approved",
          checks: { status: "success", total: 1, passed: 1, failed: 0, pending: 0, checks: [] },
          reviewers: [],
          additions: session.diff?.additions ?? 0,
          deletions: session.diff?.deletions ?? 0,
          files: 0,
        }
      }
    }
    fixture.rows.forEach((row, position) => {
      if (row.kind === "local") return
      if (row.kind === "session") return add(row.session)
      if (row.kind === "versions") {
        row.sessions.forEach((session) => add(session, undefined, id.group(row.id)))
        return
      }
      const key = id.section(row.section.id)
      sections.push({ id: key, name: row.section.name, color: row.section.color, order: position, collapsed: false })
      order.push(key)
      row.section.sessions.forEach((session) => add(session, key))
    })
    const selection = selected.at(0)
    const project: AgentProjectSnapshot = {
      id: id.project,
      root: fixture.name,
      label: fixture.name,
      pinned: index === 0,
      active: selection !== undefined,
      expanded: true,
      initialized: true,
      missing: false,
    }
    const state: AgentManagerStateMessage = {
      type: "agentManager.state",
      projectId: id.project,
      worktrees,
      sessions: worktrees.map((wt) => ({ id: `${wt.id}:session`, worktreeId: wt.id, createdAt: wt.createdAt })),
      sections,
      worktreeOrder: order,
      staleWorktreeIds: [],
      isGitRepo: true,
      defaultBaseBranch: local.branch,
      sessionsCollapsed: false,
    }
    return { project, state, stats, prs, activity, local, selection }
  })
}
