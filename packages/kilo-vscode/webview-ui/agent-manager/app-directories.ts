/**
 * Which directory each Agent Manager context reads from.
 *
 * A local session lives in the project root, a worktree session in the worktree path. The panel keeps a v2 store per
 * directory, so every read names its directory: the sidebar lists the sessions of the active project, and the pinned
 * project, the expanded projects and the open worktrees keep their stores alive.
 */
import type { AgentProjectSnapshot, ManagedSessionState } from "../src/types/messages/agent-manager"
import type { ProjectStore } from "./project/store"

export function createAppDirectories(opts: {
  projects: () => AgentProjectSnapshot[]
  activeProjectId: () => string | undefined
  store: (projectId: string) => ProjectStore
  /** Session directory when the context is known: the worktree path, else the project root. */
  currentProjectId: () => string | undefined
  selection: () => string | null
  managedSessions: () => ManagedSessionState[]
  openTabs: () => string[]
}) {
  const root = (projectId: string | undefined) =>
    opts.projects().find((project) => project.id === projectId)?.root

  const worktreePath = (worktreeId: string) =>
    opts.store(opts.activeProjectId() ?? "").worktrees().find((worktree) => worktree.id === worktreeId)?.path

  /** The worktree path in a named project, for a message that can arrive after the user switches projects. */
  const worktreePathIn = (projectId: string | undefined, worktreeId: string) =>
    projectId
      ? opts.store(projectId).worktrees().find((worktree) => worktree.id === worktreeId)?.path
      : worktreePath(worktreeId)

  /** Every directory whose sessions the active project shows: its root and every worktree. */
  const sessionDirectories = () => {
    const id = opts.activeProjectId()
    const store = id ? opts.store(id) : undefined
    const base = root(id)
    if (!store || !base) return []
    return [...new Set([base, ...store.worktrees().map((worktree) => worktree.path)])]
  }

  /** Stores that must stay alive: the pinned root, expanded project roots and open worktrees. */
  const retained = () => {
    const expanded = opts.projects()
      .filter((project) => project.expanded || project.active || project.pinned)
      .flatMap((project) => [project.root])
    const active = opts.activeProjectId()
    const store = active ? opts.store(active) : undefined
    const selection = opts.selection()
    const selected = selection && selection !== "local" ? worktreePath(selection) : undefined
    const open = opts.openTabs()
      .filter((id) => !id.startsWith("terminal") && !id.startsWith("pending"))
      .flatMap((id) => opts.managedSessions().filter((session) => session.id === id))
      .flatMap((session) => (session.worktreeId ? [worktreePath(session.worktreeId)] : []))
    return [...new Set([...expanded, ...sessionDirectories(), selected, ...open].filter((dir): dir is string => !!dir))]
  }

  /** The directory a tracked session reads from; undefined when the host has not named one. */
  const directoryOf = (sessionID: string) => {
    const managed = opts.managedSessions().find((session) => session.id === sessionID)
    if (managed?.worktreeId) return worktreePath(managed.worktreeId)
    return root(opts.currentProjectId())
  }

  return { root, worktreePath, worktreePathIn, sessionDirectories, retained, directoryOf }
}

export type AppDirectories = ReturnType<typeof createAppDirectories>
