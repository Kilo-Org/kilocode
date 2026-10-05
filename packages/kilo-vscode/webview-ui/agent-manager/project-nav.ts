/** @jsxImportSource solid-js */

import { createMemo, type Accessor } from "solid-js"
import {
  buildProjectNavOrder,
  resolveProjectNav,
  localNavId,
  worktreeNavId,
  type NavEntry,
  type NavTarget,
  LOCAL,
} from "./navigate"
import type { AgentManagerStateMessage, AgentProjectSnapshot } from "../src/types/messages"

/**
 * Sidebar keyboard-nav controller for the Agent Manager.
 *
 * Handles previous/next (⌘⌥↑/↓) and numeric-shortcut (⌘1-9) navigation across
 * the sidebar. It builds one global visual order across every expanded project:
 * Local, ungrouped worktrees, then section members,
 * using stable project-qualified composite ids, and activates each target with
 * a single atomic `agentManager.activateSelection` dispatch.
 *
 * Sessions are reachable through the history view, not the tree, so they are
 * not part of the nav order.
 *
 * The pure order/resolution logic lives in {@link navigate.ts} so it stays
 * solid/DOM-free and unit-testable; this module owns the reactive wiring and
 * the activation side effects.
 */
export interface ProjectNavDeps {
  projects: Accessor<AgentProjectSnapshot[]>
  states: Accessor<Record<string, AgentManagerStateMessage>>
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
): NavEntry[] {
  return buildProjectNavOrder(
    projects.map((p) => {
      const st = states[p.id]
      if (!st) {
        return { id: p.id, expanded: false, worktrees: [], sections: [] }
      }
      return {
        id: p.id,
        expanded: p.expanded,
        worktrees: (st.worktrees ?? []).map((w) => ({ id: w.id, sectionId: w.sectionId, groupId: w.groupId })),
        worktreeOrder: st.worktreeOrder,
        sections: (st.sections ?? []).map((s) => ({ id: s.id, collapsed: s.collapsed })),
      }
    }),
  )
}

/** DOM selector for the sidebar element backing a nav target. */
export const navSelector = (target: NavTarget): string => {
  if (target.kind === "local") return `[data-sidebar-id="${target.projectId}:local"]`
  if (target.kind === "worktree") return `[data-sidebar-id="${target.projectId}:${target.worktreeId}"]`
  return `[data-sidebar-id="${target.projectId}:sess:${target.sessionId}"]`
}

/**
 * Create the sidebar nav controller.
 *
 * @param deps    Reactive inputs describing the project catalog, state, and selection.
 * @param post    Sends the atomic `agentManager.activateSelection` message for
 *                a resolved multi-project target.
 * @param scroll  Scrolls the activated sidebar element into view.
 */
export function createProjectNav(
  deps: ProjectNavDeps,
  post: (target: NavTarget) => void,
  scroll: (el: HTMLElement) => void,
): ProjectNav {
  const projectOrder = createMemo(() => buildProjectNavEntries(deps.projects(), deps.states()))

  const currentId = createMemo((): string | undefined => {
    const pid = deps.activeProjectId()
    if (!pid) return undefined
    const sel = deps.selection()
    if (sel === LOCAL) return localNavId(pid)
    if (typeof sel === "string") return worktreeNavId(pid, sel)
    // A null selection with an open local session is "on local" for nav.
    if (sel === null && deps.currentSessionID()) return localNavId(pid)
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
    const target = resolveProjectNav(direction, currentId(), projectOrder())
    if (target) activate(target)
  }

  const jump = (index: number) => {
    if (index < 0) return
    const entry = projectOrder().at(index)
    if (entry) activate(entry)
  }

  return { step, jump }
}
