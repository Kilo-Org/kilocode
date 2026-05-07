import type { PermissionRequest, QuestionRequest } from "../src/types/messages"
import type {
  LocalGitStats,
  ManagedSessionState,
  PRStatus,
  RunStatus,
  SectionState,
  SessionInfo,
  SessionStatusInfo,
  WorktreeGitStats,
  WorktreeState,
  AgentManagerOverviewSnapshot,
} from "../src/types/messages"

type Status = AgentManagerOverviewSnapshot["sessions"][number]["status"]
type Attention = NonNullable<AgentManagerOverviewSnapshot["sessions"][number]["attention"]>
type Local = NonNullable<AgentManagerOverviewSnapshot["local"]>

export interface OverviewSnapshotInput {
  root: string
  selection: string | null
  localKey: string
  activeSessionId?: string
  worktrees: WorktreeState[]
  managedSessions: ManagedSessionState[]
  sections: SectionState[]
  sessions: SessionInfo[]
  localSessionIds: string[]
  statuses: Record<string, SessionStatusInfo>
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  worktreeStats: Record<string, WorktreeGitStats>
  localStats?: LocalGitStats
  prStatuses: Record<string, PRStatus | null>
  runStatuses: Record<string, RunStatus>
  staleWorktreeIds: Set<string>
  worktreeLabel: (wt: WorktreeState) => string
}

function tab(kind: "local" | "worktree", sessionId: string, worktreeId?: string | null) {
  return kind === "local" ? `local:${sessionId}` : `worktree:${worktreeId}:${sessionId}`
}

function status(
  sessionId: string,
  statuses: Record<string, SessionStatusInfo>,
  permissions: PermissionRequest[],
  questions: QuestionRequest[],
): { status: Status; attention: Attention } {
  if (permissions.some((item) => item.sessionID === sessionId)) return { status: "waiting", attention: "permission" }
  if (questions.some((item) => item.sessionID === sessionId)) return { status: "waiting", attention: "input" }
  const info = statuses[sessionId]
  if (!info) return { status: "unknown", attention: "none" }
  if (info.type === "busy" || info.type === "retry") return { status: "running", attention: "none" }
  if (info.type === "offline") return { status: "failed", attention: "error" }
  return { status: "idle", attention: "none" }
}

function maxDate(values: Array<string | undefined>) {
  const sorted = values.filter((value): value is string => !!value).sort((a, b) => Date.parse(b) - Date.parse(a))
  return sorted[0]
}

function age(value: string | undefined, now: number) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? now - parsed : 0
}

function staleSession(status: Status, updatedAt: string | undefined, now: number) {
  if (status === "failed") return "failed"
  if (status === "waiting" && age(updatedAt, now) > 5 * 60 * 1000) return "waiting for more than 5m"
  if (status === "running" && age(updatedAt, now) > 10 * 60 * 1000) return "running with no activity for more than 10m"
  return undefined
}

function staleWorktree(input: { missing: boolean; status: Status | "inactive"; updatedAt?: string }, now: number) {
  if (input.missing) return "worktree missing"
  if (input.status === "failed") return "failed"
  if (input.status === "waiting" && age(input.updatedAt, now) > 5 * 60 * 1000) return "waiting for more than 5m"
  if (input.status === "running" && age(input.updatedAt, now) > 10 * 60 * 1000)
    return "running with no activity for more than 10m"
  return undefined
}

function aggregate(statuses: Status[]) {
  if (statuses.includes("failed")) return "failed" as const
  if (statuses.includes("waiting")) return "waiting" as const
  if (statuses.includes("running")) return "running" as const
  if (statuses.includes("unknown")) return "unknown" as const
  if (statuses.includes("idle")) return "idle" as const
  if (statuses.includes("done")) return "done" as const
  return "unknown" as const
}

function counts(sessions: Array<{ status: Status; stale: boolean }>) {
  const count = (value: Status) => sessions.filter((item) => item.status === value).length
  return {
    total: sessions.length,
    running: count("running"),
    waiting: count("waiting"),
    idle: count("idle"),
    done: count("done"),
    failed: count("failed"),
    stale: sessions.filter((item) => item.stale).length,
  }
}

export function buildOverviewSnapshot(input: OverviewSnapshotInput): AgentManagerOverviewSnapshot {
  const now = Date.now()
  const all = new Map(input.sessions.map((item) => [item.id, item]))
  const wts = new Map(input.worktrees.map((item) => [item.id, item]))
  const secs = new Map(input.sections.map((item) => [item.id, item]))
  const localIds = new Set([
    ...input.localSessionIds.filter((id) => !id.startsWith("pending:")),
    ...input.managedSessions.filter((item) => item.worktreeId === null).map((item) => item.id),
  ])
  const managed = [
    ...input.managedSessions.filter((item) => item.worktreeId !== null),
    ...[...localIds].map(
      (id) =>
        input.managedSessions.find((item) => item.id === id) ?? {
          id,
          worktreeId: null,
          createdAt: all.get(id)?.createdAt ?? new Date(now).toISOString(),
        },
    ),
  ]

  const sessions: AgentManagerOverviewSnapshot["sessions"] = managed.map((item) => {
    const wt = item.worktreeId ? wts.get(item.worktreeId) : undefined
    const sec = wt?.sectionId ? secs.get(wt.sectionId)?.name : undefined
    const kind: "local" | "worktree" = item.worktreeId ? "worktree" : "local"
    const info = all.get(item.id)
    const state = status(item.id, input.statuses, input.permissions, input.questions)
    const staleReason = staleSession(state.status, info?.updatedAt, now)
    return {
      id: item.id,
      tabId: tab(kind, item.id, item.worktreeId),
      worktreeId: item.worktreeId,
      requestId: item.requestId,
      kind,
      section: sec ?? (kind === "local" ? "Local" : "Worktrees"),
      name: info?.title || item.id,
      cwd: wt?.path ?? input.root,
      status: state.status,
      selected: input.activeSessionId === item.id,
      startedAt: item.createdAt ?? info?.createdAt,
      lastActivityAt: info?.updatedAt,
      stale: !!staleReason,
      ...(staleReason ? { staleReason } : {}),
      attention: state.attention,
    }
  })

  const tabs: AgentManagerOverviewSnapshot["tabs"] = sessions.map((item) => ({
    id: item.tabId,
    kind: item.kind,
    selected: item.selected,
    section: item.section,
    name: item.name,
    cwd: item.cwd,
    worktreeId: item.worktreeId,
    sessionId: item.id,
    status: item.status,
    lastActivityAt: item.lastActivityAt,
    stale: item.stale,
    ...(item.staleReason ? { staleReason: item.staleReason } : {}),
  }))

  const worktrees: AgentManagerOverviewSnapshot["worktrees"] = input.worktrees.map((wt) => {
    const stats = input.worktreeStats[wt.id]
    const children = sessions.filter((item) => item.worktreeId === wt.id)
    const status: AgentManagerOverviewSnapshot["worktrees"][number]["status"] =
      children.length > 0 ? aggregate(children.map((item) => item.status)) : "inactive"
    const lastActivityAt = maxDate(children.map((item) => item.lastActivityAt))
    const section = wt.sectionId ? secs.get(wt.sectionId)?.name : undefined
    const live = input.prStatuses[wt.id]
    const pr: AgentManagerOverviewSnapshot["worktrees"][number]["pr"] = live
      ? {
          attached: true,
          number: live.number,
          url: live.url,
          state: live.state,
          review: live.review,
          checks: live.checks.status,
        }
      : wt.prNumber
        ? {
            attached: true,
            number: wt.prNumber,
            ...(wt.prUrl ? { url: wt.prUrl } : {}),
            ...(wt.prState ? { state: wt.prState } : {}),
          }
        : { attached: false }
    const staleReason = staleWorktree(
      { missing: input.staleWorktreeIds.has(wt.id), status, updatedAt: lastActivityAt },
      now,
    )
    const run = input.runStatuses[wt.id]?.state
    const runState: AgentManagerOverviewSnapshot["worktrees"][number]["runState"] =
      run === "idle" ? "stopped" : (run ?? "unknown")
    const req = wt.requestId ?? children.find((item) => item.requestId)?.requestId
    const out: AgentManagerOverviewSnapshot["worktrees"][number] = {
      id: wt.id,
      section: section ?? "Worktrees",
      name: input.worktreeLabel(wt),
      path: wt.path,
      branch: wt.branch,
      base: wt.parentBranch,
      selected: input.selection === wt.id,
      status,
      sessionIds: children.map((item) => item.id),
      tabIds: children.map((item) => item.tabId),
      ...(req ? { requestId: req } : {}),
      ...(stats
        ? {
            git: {
              changes: stats.files,
              files: stats.files,
              additions: stats.additions,
              deletions: stats.deletions,
              ahead: stats.ahead,
              behind: stats.behind,
              conflicts: 0,
              hasPr: pr.attached,
            },
          }
        : {}),
      pr,
      runState,
      ...(lastActivityAt ? { lastActivityAt } : {}),
      stale: !!staleReason,
      ...(staleReason ? { staleReason } : {}),
    }
    return out
  })

  const local = buildLocal(input, sessions, now)

  const sections = input.sections.map((sec) => {
    const sectionWorktrees = worktrees.filter(
      (wt) => input.worktrees.find((item) => item.id === wt.id)?.sectionId === sec.id,
    )
    const sectionSessions = sessions.filter((item) => sectionWorktrees.some((wt) => wt.id === item.worktreeId))
    return {
      id: sec.id,
      name: sec.name,
      selected: sectionWorktrees.some((wt) => wt.selected),
      collapsed: sec.collapsed,
      tabIds: sectionSessions.map((item) => item.tabId),
      worktreeIds: sectionWorktrees.map((item) => item.id),
      sessionIds: sectionSessions.map((item) => item.id),
      summary: counts(sectionSessions),
    }
  })

  const requestIds = new Set([
    ...sessions.flatMap((item) => (item.requestId ? [item.requestId] : [])),
    ...worktrees.flatMap((item) => (item.requestId ? [item.requestId] : [])),
  ])
  const requests = [...requestIds].map((id) => {
    const requestSessions = sessions.filter((item) => item.requestId === id)
    const requestWorktrees = worktrees.filter((item) => item.requestId === id)
    return {
      id,
      source: "agent_manager",
      mode: requestWorktrees.length > 0 ? "worktree" : "local",
      sessionIds: requestSessions.map((item) => item.id),
      worktreeIds: requestWorktrees.map((item) => item.id),
      status: aggregate(requestSessions.map((item) => item.status)),
      summary: counts(requestSessions),
    }
  })

  const activeSession = sessions.find((item) => item.id === input.activeSessionId)
  const selectedWorktree = input.selection && input.selection !== input.localKey ? input.selection : undefined
  const activeWorktreeId =
    activeSession?.worktreeId ?? selectedWorktree ?? (input.selection === input.localKey ? null : undefined)
  const activeTabId = activeSession?.tabId
  const total = counts(sessions)
  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    root: input.root,
    active: {
      ...(activeTabId ? { tabId: activeTabId } : {}),
      ...(input.activeSessionId ? { sessionId: input.activeSessionId } : {}),
      ...(activeWorktreeId !== undefined ? { worktreeId: activeWorktreeId } : {}),
    },
    summary: {
      ...total,
      worktrees: worktrees.length,
      localTabs: sessions.filter((item) => item.kind === "local").length,
    },
    requests,
    sections,
    tabs,
    worktrees,
    local,
    sessions,
  }
}

function buildLocal(
  input: OverviewSnapshotInput,
  sessions: AgentManagerOverviewSnapshot["sessions"],
  now: number,
): Local {
  const localSessions = sessions.filter((item) => item.kind === "local")
  const localStatus: Local["status"] =
    localSessions.length > 0 ? aggregate(localSessions.map((item) => item.status)) : "inactive"
  const localActivity = maxDate(localSessions.map((item) => item.lastActivityAt))
  const localStats = input.localStats
  const localStale =
    localStatus === "waiting" && age(localActivity, now) > 5 * 60 * 1000
      ? "waiting for more than 5m"
      : localStatus === "running" && age(localActivity, now) > 10 * 60 * 1000
        ? "running with no activity for more than 10m"
        : undefined
  const run = input.runStatuses[input.localKey]?.state
  const localRun: Local["runState"] = run === "idle" ? "stopped" : (run ?? "unknown")
  const local: Local = {
    selected: input.selection === input.localKey,
    cwd: input.root,
    ...(localStats?.branch ? { branch: localStats.branch } : {}),
    status: localStatus,
    sessionIds: localSessions.map((item) => item.id),
    tabIds: localSessions.map((item) => item.tabId),
    ...(localStats
      ? {
          stats: {
            changes: localStats.files,
            files: localStats.files,
            additions: localStats.additions,
            deletions: localStats.deletions,
            ahead: localStats.ahead,
            behind: localStats.behind,
            conflicts: 0,
          },
        }
      : {}),
    runState: localRun,
    ...(localActivity ? { lastActivityAt: localActivity } : {}),
    stale: !!localStale,
    ...(localStale ? { staleReason: localStale } : {}),
  }
  return local
}
