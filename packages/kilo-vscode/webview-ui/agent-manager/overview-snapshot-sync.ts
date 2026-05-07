import { createEffect, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type {
  AgentManagerOverviewSnapshot,
  LocalGitStats,
  ManagedSessionState,
  PermissionRequest,
  PRStatus,
  QuestionRequest,
  RunStatus,
  SectionState,
  SessionInfo,
  SessionStatusInfo,
  WorktreeGitStats,
  WorktreeState,
} from "../src/types/messages"
import { buildOverviewSnapshot } from "./overview-snapshot"

export interface OverviewSnapshotSyncInput {
  root: Accessor<string>
  selection: Accessor<string | null>
  localKey: string
  activeSessionId: Accessor<string | undefined>
  worktrees: Accessor<WorktreeState[]>
  managedSessions: Accessor<ManagedSessionState[]>
  sections: Accessor<SectionState[]>
  sessions: Accessor<SessionInfo[]>
  localSessionIds: Accessor<string[]>
  statuses: () => Record<string, SessionStatusInfo>
  permissions: Accessor<PermissionRequest[]>
  questions: Accessor<QuestionRequest[]>
  worktreeStats: Accessor<Record<string, WorktreeGitStats>>
  localStats: Accessor<LocalGitStats | undefined>
  prStatuses: Accessor<Record<string, PRStatus | null>>
  runStatuses: Accessor<Record<string, RunStatus>>
  staleWorktreeIds: Accessor<Set<string>>
  worktreeLabel: (wt: WorktreeState) => string
  post: (snapshot: AgentManagerOverviewSnapshot) => void
}

export function createOverviewSnapshotSync(input: OverviewSnapshotSyncInput) {
  const timer: { id?: ReturnType<typeof setTimeout> } = {}

  const track = () => {
    const statuses = input.statuses()
    for (const item of input.managedSessions()) statuses[item.id]?.type
    for (const id of input.localSessionIds()) statuses[id]?.type
  }

  const post = () => {
    const root = input.root()
    if (!root) return
    input.post(
      buildOverviewSnapshot({
        root,
        selection: input.selection(),
        localKey: input.localKey,
        activeSessionId: input.activeSessionId(),
        worktrees: input.worktrees(),
        managedSessions: input.managedSessions(),
        sections: input.sections(),
        sessions: input.sessions(),
        localSessionIds: input.localSessionIds(),
        statuses: input.statuses(),
        permissions: input.permissions(),
        questions: input.questions(),
        worktreeStats: input.worktreeStats(),
        localStats: input.localStats(),
        prStatuses: input.prStatuses(),
        runStatuses: input.runStatuses(),
        staleWorktreeIds: input.staleWorktreeIds(),
        worktreeLabel: input.worktreeLabel,
      }),
    )
  }

  const schedule = () => {
    clearTimeout(timer.id)
    timer.id = setTimeout(post, 500)
  }

  onCleanup(() => clearTimeout(timer.id))

  createEffect(() => {
    input.root()
    input.selection()
    input.activeSessionId()
    input.worktrees()
    input.managedSessions()
    input.sections()
    input.sessions()
    input.localSessionIds()
    track()
    input.permissions()
    input.questions()
    input.worktreeStats()
    input.localStats()
    input.prStatuses()
    input.runStatuses()
    input.staleWorktreeIds()
    schedule()
  })
}
