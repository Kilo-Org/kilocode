/**
 * Per-project live stats store for the multi-project accordion.
 *
 * Each expanded project's own pollers push worktree/local/PR stats tagged with
 * their projectId. This store keeps those payloads per project so every
 * expanded accordion summary renders live data; payloads for the active
 * project additionally flow into the shared signals the interactive body reads.
 */

import { createSignal } from "solid-js"
import type {
  AgentManagerLocalStatsMessage,
  AgentManagerPRStatusMessage,
  AgentManagerWorktreeStatsMessage,
  ExtensionMessage,
  LocalGitStats,
  PRStatus,
  ProjectSessionInfo,
  WorktreeGitStats,
} from "../../src/types/messages"

export interface ProjectLiveDeps {
  /** Store of the message's owning project (active store when undefined). */
  ensure: (pid: string | undefined) => {
    setWorktreeStats: (map: Record<string, WorktreeGitStats>) => void
    setLocalStats: (stats: LocalGitStats) => void
    setPrStatuses: (update: (prev: Record<string, PRStatus | null>) => Record<string, PRStatus | null>) => void
  }
}

export function createProjectLive(deps: ProjectLiveDeps) {
  const [stats, setStats] = createSignal<Record<string, Record<string, WorktreeGitStats>>>({})
  const [local, setLocal] = createSignal<Record<string, LocalGitStats>>({})
  const [prs, setPrs] = createSignal<Record<string, Record<string, PRStatus | null>>>({})
  const [sessions, setSessions] = createSignal<Record<string, ProjectSessionInfo[]>>({})

  /** Route one stats/PR message; returns true when the message was consumed. */
  const apply = (msg: ExtensionMessage): boolean => {
    if (msg.type === "agentManager.worktreeStats") {
      const ev = msg as AgentManagerWorktreeStatsMessage
      const map: Record<string, WorktreeGitStats> = {}
      for (const s of ev.stats) map[s.worktreeId] = s
      deps.ensure(ev.projectId).setWorktreeStats(map)
      if (ev.projectId) setStats((prev) => ({ ...prev, [ev.projectId!]: map }))
      return true
    }
    if (msg.type === "agentManager.localStats") {
      const ev = msg as AgentManagerLocalStatsMessage
      deps.ensure(ev.projectId).setLocalStats(ev.stats)
      if (ev.projectId) setLocal((prev) => ({ ...prev, [ev.projectId!]: ev.stats }))
      return true
    }
    if (msg.type === "agentManager.prStatus") {
      const ev = msg as AgentManagerPRStatusMessage
      deps.ensure(ev.projectId).setPrStatuses((prev) => ({ ...prev, [ev.worktreeId]: ev.pr }))
      if (ev.projectId)
        setPrs((prev) => ({ ...prev, [ev.projectId!]: { ...prev[ev.projectId!], [ev.worktreeId]: ev.pr } }))
      return true
    }
    if (msg.type === "agentManager.projectSessions") {
      setSessions((prev) => ({ ...prev, [msg.projectId]: msg.sessions }))
      return true
    }
    return false
  }

  /** Drop stores of projects that left the catalog. */
  const prune = (ids: Set<string>) => {
    const keep = <T>(prev: Record<string, T>) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id)))
    setStats((prev) => keep(prev))
    setLocal((prev) => keep(prev))
    setPrs((prev) => keep(prev))
    setSessions((prev) => keep(prev))
  }

  return { stats, local, prs, sessions, apply, prune }
}
