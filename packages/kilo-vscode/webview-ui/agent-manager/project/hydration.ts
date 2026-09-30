import { batch } from "solid-js"
import type { AgentManagerStateMessage } from "../../src/types/messages"
import { LOCAL } from "../navigate"
import { applyTabOrder } from "../tab-order"
import { pruneClosed, restoreTrackedTabs, trackedSessionInventory } from "../../src/utils/local-tabs"
import { needsLocalDraft } from "./local-tabs"
import { restoreProjectTarget, type RestoreDeps } from "./restore"

export function createProjectHydration(opts: {
  switch: (state: AgentManagerStateMessage) => "first" | "switched" | "same"
  restricted: (value: boolean) => void
  repo: (value: boolean) => void
  loaded: () => void
  sessionsLoaded: () => void
  style: (value: "split" | "unified") => void
  markdown: (value: boolean) => void
  current: () => string | undefined
  settingUp: () => boolean
  sessions: () => Parameters<typeof trackedSessionInventory>[1]
  tabs: () => string[]
  closed: () => Set<string>
  pending: (id: string) => boolean
  setTabs: (ids: string[]) => void
  terminals: () => { id: string }[]
  draft: () => void
  restore: RestoreDeps
  focus: () => void
  sidebar: (value: boolean | undefined) => void
}) {
  return (state: AgentManagerStateMessage) =>
    batch(() => {
      const switched = opts.switch(state)
      opts.restricted(state.restricted === true)
      if (state.isGitRepo !== undefined) opts.repo(state.isGitRepo)
      opts.loaded()
      if (state.isGitRepo === false) opts.sessionsLoaded()
      if (state.reviewDiffStyle === "split" || state.reviewDiffStyle === "unified") opts.style(state.reviewDiffStyle)
      opts.markdown(state.reviewMarkdownRender === true)
      const current = opts.current()
      if (current && !opts.settingUp()) {
        const session = state.sessions.find((item) => item.id === current)
        if (session?.worktreeId) opts.restore.setSelection(session.worktreeId)
      }
      const tracked = trackedSessionInventory(state.sessions, opts.sessions())
      const closed = opts.closed()
      pruneClosed(closed, state.sessions)
      const restored = restoreTrackedTabs(
        tracked,
        opts.tabs(),
        state.tabOrder?.[LOCAL],
        opts.pending,
        applyTabOrder,
        closed,
      )
      if (restored) opts.setTabs(restored)
      if (switched === "switched" && needsLocalDraft(opts.tabs(), opts.terminals())) opts.draft()
      if (switched !== "same") {
        restoreProjectTarget(state, opts.restore)
        opts.focus()
      }
      opts.sidebar(state.sidebarCollapsed)
    })
}
