/**
 * One place that decides which keyboard shortcut the prompt suggests.
 *
 * The empty prompt shows at most one hint, in place of the generic key help in
 * its placeholder. Rules are ordered by how strong the
 * signal of user intent is. A hint only shows when its shortcut works in the
 * current state, so it never teaches something that does nothing.
 */

export type HintLabel = "addSelection" | "waiting" | "type" | "sessions" | "stop" | "changes" | "pr"

export interface Hint {
  binding: string
  label: HintLabel
}

/** Agent Manager state. Missing in the sidebar and editor tabs. */
export interface ManagerContext {
  /** The selected worktree has uncommitted or branch changes. */
  changes: boolean
  /** The selected worktree has a pull request. */
  pr: boolean
  /** The side panel that is open now. */
  panel?: "diff" | "pr" | "other"
  /** Number of worktrees in the sidebar, in addition to local. */
  worktrees: number
  /** Sidebar jump number (1-9) of another session that waits for an answer. */
  waiting?: number
}

export interface HintContext {
  /** Formatted shortcut labels by binding name. */
  bindings: Record<string, string>
  /** The prompt textarea has focus. */
  focused: boolean
  /** Focus is outside this webview, for example in an editor or terminal. */
  away: boolean
  /** The prompt has text. */
  draft: boolean
  /** The current session is running. */
  busy: boolean
  /** The active editor has selected text. */
  selection: boolean
  manager?: ManagerContext
}

const hint = (binding: string | undefined, label: HintLabel): Hint | undefined =>
  binding ? { binding, label } : undefined

/** Previous and next session, when there is another session to switch to. */
function sessions(kb: Record<string, string>, am?: ManagerContext): Hint | undefined {
  if (!am || am.worktrees === 0 || !kb.previousSession || !kb.nextSession) return undefined
  return { binding: `${kb.previousSession} ${kb.nextSession}`, label: "sessions" }
}

/** The finished agent left something to review that is not open yet. */
function review(kb: Record<string, string>, am: ManagerContext): Hint | undefined {
  const diff = am.changes && am.panel !== "diff" ? hint(kb.toggleDiff, "changes") : undefined
  if (diff) return diff
  return am.pr && am.panel !== "pr" ? hint(kb.openPR, "pr") : undefined
}

export function recommend(ctx: HintContext): Hint | undefined {
  const kb = ctx.bindings
  const am = ctx.manager

  // The hint is part of the placeholder, so a draft hides it.
  if (ctx.draft) return undefined

  // The user selected code in an editor: adding it to the chat is the next step.
  // "Add to context" only works while the editor has focus.
  const add = ctx.away && ctx.selection ? hint(kb.addToContext, "addSelection") : undefined
  if (add) return add

  // Another Agent Manager session is blocked on the user. This beats everything
  // in this session, because that agent cannot continue without an answer.
  const jump = am?.waiting ? hint(kb[`jumpTo${am.waiting}`], "waiting") : undefined
  if (jump) return jump

  // Focus is somewhere else: show how to get back to the prompt.
  if (!ctx.focused) return hint(am ? kb.agentManagerOpen : kb.focusChatInput, "type")

  // The agent is running. In Agent Manager the user can work on another session
  // meanwhile; elsewhere the useful key is to stop the run.
  if (ctx.busy) return sessions(kb, am) ?? { binding: "Esc", label: "stop" }

  if (!am) return undefined
  return review(kb, am) ?? sessions(kb, am)
}
