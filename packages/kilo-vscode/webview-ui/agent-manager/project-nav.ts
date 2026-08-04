/** @jsxImportSource solid-js */

import { createMemo, type Accessor } from "solid-js"
import {
  buildProjectNavOrder,
  resolveProjectNav,
  localNavId,
  worktreeNavId,
  sessionNavId,
  type NavEntry,
  type NavTarget,
  LOCAL,
} from "./navigate"
import type { SidebarItem } from "./section-helpers"
import type { AgentManagerStateMessage, AgentProjectSnapshot, ProjectSessionInfo } from "../src/types/messages"

/**
 * Sidebar keyboard-nav controller for the Agent Manager.
 *
 * Handles previous/next (⌘⌥↑/↓) and numeric-shortcut (⌘1-9) navigation across
 * the sidebar. In multi-project mode it builds one global visual order across
 * every expanded project — Local, ungrouped worktrees, then section members,
 * and visible unassigned sessions — using stable project-qualified composite
 * ids, and activates each target with a single atomic
 * `agentManager.activateSelection` dispatch. In single-project mode it keeps
 * the legacy in-process traversal over the active project's flat sidebar order.
 *
 * The pure order/resolution logic lives in {@link navigate.ts} so it stays
 * solid/DOM-free and unit-testable; this module owns the reactive wiring and
 * the activation side effects.
 */
export interface ProjectNavDeps {
  multiProject: Accessor<boolean>
  /** Legacy flat sidebar order for single-project mode (LOCAL, worktrees, sessions). */
  sidebarOrder: Accessor<SidebarItem[]>
  /** Legacy in-process activator for single-project mode. */
  focus: (item: SidebarItem) => void
  projects: Accessor<AgentProjectSnapshot[]>
  states: Accessor<Record<string, AgentManagerStateMessage>>
  sessions: Accessor<Record<string, ProjectSessionInfo[]>>
  activeProjectId: Accessor<string | undefined>
  selection: Accessor<typeof LOCAL | string | null>
  currentSessionID: Accessor<string | undefined>
}

export interface ProjectNav {
  step: (direction: "up" | "down") => void
  jump: (index: number) => void
}

/** Build the same global order used by keyboard navigation and shortcut badges. */
export function buildProjectNavEntries(
  projects: AgentProjectSnapshot[],
  states: Record<string, AgentManagerStateMessage>,
  sessions: Record<string, ProjectSessionInfo[]>,
): NavEntry[] {
  return buildProjectNavOrder(
    projects.map((p) => {
      const st = states[p.id]
      if (!st) {
        return { id: p.id, expanded: false, worktrees: [], sections: [], sessionsCollapsed: false, unassigned: [] }
      }
      return {
        id: p.id,
        expanded: p.expanded,
        worktrees: (st.worktrees ?? []).map((w) => ({ id: w.id, sectionId: w.sectionId, groupId: w.groupId })),
        worktreeOrder: st.worktreeOrder,
        sections: (st.sections ?? []).map((s) => ({ id: s.id, collapsed: s.collapsed })),
        sessionsCollapsed: st.sessionsCollapsed === true,
        unassigned: (sessions[p.id] ?? []).filter((s) => s.worktreeId === null).map((s) => ({ id: s.id })),
      }
    }),
  )
}

/** DOM selector for the sidebar element backing a nav target. */
export const navSelector = (target: NavTarget): string => {
  if (target.kind === "local") return `[data-sidebar-id="${target.projectId}:local"]`
  if (target.kind === "worktree") return `[data-sidebar-id="${target.projectId}:${target.worktreeId}"]`
  return `[data-sidebar-id="${sessionNavId(target.projectId, target.sessionId)}"]`
}

/**
 * Create the sidebar nav controller.
 *
 * @param deps    Reactive inputs (signals/accessors) describing multi-project
 *                catalog/state, the legacy single-project order/focus, and the
 *                current selection.
 * @param post    Sends the atomic `agentManager.activateSelection` message for
 *                a resolved multi-project target.
 * @param scroll  Scrolls the activated sidebar element into view.
 */
export function createProjectNav(
  deps: ProjectNavDeps,
  post: (target: NavTarget) => void,
  scroll: (el: HTMLElement) => void,
): ProjectNav {
  const projectOrder = createMemo((): NavEntry[] => {
    if (!deps.multiProject()) return []
    const states = deps.states()
    const live = deps.sessions()
    return buildProjectNavEntries(deps.projects(), states, live)
  })

  const currentId = createMemo((): string | undefined => {
    if (!deps.multiProject()) return undefined
    const pid = deps.activeProjectId()
    if (!pid) return undefined
    const sel = deps.selection()
    if (sel === LOCAL) return localNavId(pid)
    if (typeof sel === "string") return worktreeNavId(pid, sel)
    if (sel === null) {
      const sid = deps.currentSessionID()
      if (sid) return sessionNavId(pid, sid)
    }
    return undefined
  })

  const activate = (entry: NavEntry) => {
    post(entry.target)
    const sel = navSelector(entry.target)
    requestAnimationFrame(() => {
      const el = document.querySelector(sel)
      if (el instanceof HTMLElement) scroll(el)
    })
  }

  const step = (direction: "up" | "down") => {
    if (deps.multiProject()) {
      const target = resolveProjectNav(direction, currentId(), projectOrder())
      if (target) activate(target)
      return
    }
    const flat = deps.sidebarOrder()
    if (flat.length === 0) return
    const current = deps.selection() ?? deps.currentSessionID()
    const idx = current ? flat.findIndex((f) => f.id === current) : -1
    const next = direction === "up" ? idx - 1 : idx + 1
    if (next < 0 || next >= flat.length) return
    deps.focus(flat[next]!)
  }

  const jump = (index: number) => {
    if (deps.multiProject()) {
      const entry = projectOrder()[index]
      if (entry) activate(entry)
      return
    }
    const item = deps.sidebarOrder()[index]
    if (item) deps.focus(item)
  }

  return { step, jump }
}
