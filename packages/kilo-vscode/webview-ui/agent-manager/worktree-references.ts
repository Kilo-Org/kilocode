import { createEffect, createMemo, type Accessor } from "solid-js"
import type { SessionInfo } from "../src/types/messages"
import type { useVSCode } from "../src/context/vscode"
import type { WorktreeReference } from "../src/hooks/file-mention-utils"
import type { ProjectStore } from "./project/store"
import { firstOrderedTitle } from "./tab-order"
import { sortWorktrees } from "./section-helpers"
import { createWorktreeRecency } from "./worktree-recency"

type Session = Pick<SessionInfo, "id" | "title"> & Partial<Pick<SessionInfo, "updatedAt">>

export function worktreeReferences(
  state: ProjectStore,
  sessions: Session[],
  current: string | null,
  recent: string[] = [],
): WorktreeReference[] {
  const titles = new Map(sessions.map((session) => [session.id, session.title]))
  const updated = new Map(sessions.map((session) => [session.id, Date.parse(session.updatedAt ?? "") || 0]))
  const recency = new Map(recent.map((path, index) => [path, index]))
  const activity = new Map<string, number>()
  const groups = new Map<string, WorktreeReference["sessions"]>()
  for (const session of state.managedSessions()) {
    if (!session.worktreeId) continue
    const group = groups.get(session.worktreeId) ?? []
    group.push({ id: session.id, title: titles.get(session.id) })
    groups.set(session.worktreeId, group)
  }
  return sortWorktrees(state.worktrees(), state.worktreeOrder())
    .map((worktree) => {
      const sessions = groups.get(worktree.id) ?? []
      const basename = worktree.path.replaceAll("\\", "/").replace(/\/+$/, "").split("/").pop()
      activity.set(
        worktree.path,
        Math.max(Date.parse(worktree.createdAt) || 0, ...sessions.map((session) => updated.get(session.id) ?? 0)),
      )
      return {
        id: worktree.id,
        name: worktree.label || firstOrderedTitle(sessions, state.tabOrder()[worktree.id], basename || worktree.branch),
        branch: worktree.branch,
        path: worktree.path,
        base: worktree.parentBranch,
        sessions,
        disabled: worktree.id === current || state.staleWorktreeIds().has(worktree.id) || state.busy().has(worktree.id),
      }
    })
    .sort(
      (a, b) =>
        (recency.get(a.path) ?? recent.length) - (recency.get(b.path) ?? recent.length) ||
        (activity.get(b.path) ?? 0) - (activity.get(a.path) ?? 0),
    )
}

export function createWorktreeReferences(
  vscode: Pick<ReturnType<typeof useVSCode>, "getState" | "setState">,
  state: Accessor<ProjectStore>,
  sessions: Accessor<Session[]>,
  selection: Accessor<string | null>,
) {
  const recency = createWorktreeRecency({
    get: () => vscode.getState<Record<string, unknown>>(),
    set: (value) => vscode.setState(value),
  })
  const current = createMemo(() => {
    const project = state()
    const id = selection()
    if (!id || project.staleWorktreeIds().has(id) || project.busy().has(id)) return
    return project.worktrees().find((worktree) => worktree.id === id)?.path
  })
  createEffect(() => {
    const path = current()
    if (path) recency.visit(path)
  })
  return createMemo(() => worktreeReferences(state(), sessions(), selection(), recency.recent()))
}
