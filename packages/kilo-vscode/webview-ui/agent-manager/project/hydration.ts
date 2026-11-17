import { batch } from "solid-js"
import type { AgentManagerStateMessage } from "../../src/types/messages/agent-manager"
import { LOCAL } from "../navigate"
import { applyTabOrder } from "../tab-order"
import { restoreTrackedTabs, trackedSessionInventory } from "../../src/utils/local-tabs"
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
  /**
   * Root sessions the panel knows, with their server directory when loaded. The directory lets the restore follow
   * where a session runs instead of a filing an older build left behind.
   */
  sessions: () => (Parameters<typeof trackedSessionInventory>[1][number] & { location?: { directory?: string } })[]
  /** The host catalog for the current project, which can carry directories before the stores list. */
  catalog?: () => { id: string; location?: { directory?: string } }[] | undefined
  /** The project root, for placing a server directory on Local. */
  root: () => string | undefined
  tabs: () => string[]
  closed: () => ReadonlySet<string>
  pending: (id: string) => boolean
  setTabs: (ids: string[]) => void
  terminals: () => { id: string }[]
  draft: () => void
  restore: RestoreDeps
  selection: () => string | null
  focus: () => void
  sidebar: (value: boolean | undefined) => void
}) {
  // A cold webview receives the state before the host catalog lists the project. Remember the target so the restore
  // can finish when the catalog arrives, unless the user navigates away first.
  let waiting: { projectId: string; state: AgentManagerStateMessage; sessionId: string; selection: string } | undefined
  const directoryOf = (sessionId: string): string | undefined =>
    opts.catalog?.()?.find((item) => item.id === sessionId)?.location?.directory ??
    opts.sessions().find((item) => item.id === sessionId)?.location?.directory

  /**
   * Finish the remembered restore when either the catalog lists its directory or a later state payload corrects its
   * filing. The host's one-time repair can fix a filing before the catalog lists an old session, so both signals
   * count. A state that still says the same thing keeps the wait for the next signal.
   */
  const replay = (projectId: string, next?: AgentManagerStateMessage) => {
    const pending = waiting
    if (!pending || pending.projectId !== projectId) return
    // The user may have navigated while the catalog loaded; only finish the target they left.
    if (opts.selection() !== pending.selection || opts.current() !== pending.sessionId) {
      waiting = undefined
      return
    }
    const source = next ?? pending.state
    const directory = directoryOf(pending.sessionId)
    const filed = filingOf(source, pending.sessionId)
    if (directory === undefined && filed === filingOf(pending.state, pending.sessionId)) {
      if (next) waiting = { ...pending, state: next }
      return
    }
    waiting = undefined
    restoreProjectTarget(source, { ...opts.restore, rootOf: opts.root, directoryOf })
    opts.focus()
  }

  const hydrate = ((state: AgentManagerStateMessage) => {
    const switched = opts.switch(state)
    batch(() => {
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
      const restored = restoreTrackedTabs(
        tracked,
        opts.tabs(),
        state.tabOrder?.[LOCAL],
        opts.pending,
        applyTabOrder,
        opts.closed(),
      )
      if (restored) opts.setTabs(restored)
      if (switched === "switched" && needsLocalDraft(opts.tabs(), opts.terminals())) opts.draft()
      if (switched !== "same") {
        restoreProjectTarget(state, { ...opts.restore, rootOf: opts.root, directoryOf })
        opts.focus()
        waiting = pendingRestore(state, directoryOf)
      }
      opts.sidebar(state.sidebarCollapsed)
    })
    if (switched === "same") replay(state.projectId ?? "", state)
  }) as ((state: AgentManagerStateMessage) => void) & { catalog(projectId: string): void }

  hydrate.catalog = (projectId: string) => replay(projectId)

  return hydrate
}

function filingOf(state: AgentManagerStateMessage, sessionId: string): string | null | undefined {
  return state.sessions.find((item) => item.id === sessionId)?.worktreeId
}

/** A project with no open tab and no terminal gets the empty composer. */
export function needsLocalDraft(sessions: readonly string[], terminals: readonly { id: string }[]): boolean {
  return sessions.length === 0 && terminals.length === 0
}

/**
 * The session target a cold restore could not place, or undefined when the restore already saw the server directory
 * or the target is not a session. The recorded selection is the filing the restore fell back to.
 */
function pendingRestore(
  state: AgentManagerStateMessage,
  directoryOf: (sessionId: string) => string | undefined,
) {
  const target = state.activeTarget
  if (target?.kind !== "session" || target.projectId !== state.projectId) return undefined
  if (directoryOf(target.sessionId) !== undefined) return undefined
  const filed = state.sessions.find((item) => item.id === target.sessionId)
  const selection =
    filed?.worktreeId && state.worktrees.some((wt) => wt.id === filed.worktreeId) ? filed.worktreeId : LOCAL
  return { projectId: state.projectId!, state, sessionId: target.sessionId, selection }
}
