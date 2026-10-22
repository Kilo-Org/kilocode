/**
 * One place that decides which keyboard shortcut the prompt suggests.
 *
 * The empty prompt shows at most one hint, in place of the generic key help in
 * its placeholder. Rules are ordered by how strong the
 * signal of user intent is. A hint only shows when its shortcut works in the
 * current state, so it never teaches something that does nothing.
 */

export type HintLabel = "addSelection" | "type" | "sessions" | "stop"

export interface Hint {
  binding: string
  label: HintLabel
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
  /** The sidebar or editor tab has another session tab to switch to. */
  tabs?: boolean
}

const hint = (binding: string | undefined, label: HintLabel): Hint | undefined =>
  binding ? { binding, label } : undefined

/** Previous and next session, when there is another session to switch to. */
function sessions(kb: Record<string, string>, tabs?: boolean): Hint | undefined {
  return tabs ? pair(kb.previousTab, kb.nextTab) : undefined
}

const pair = (prev: string | undefined, next: string | undefined): Hint | undefined =>
  prev && next ? { binding: `${prev} ${next}`, label: "sessions" } : undefined

export function recommend(ctx: HintContext): Hint | undefined {
  const kb = ctx.bindings

  // The hint is part of the placeholder, so a draft hides it.
  if (ctx.draft) return undefined

  // The user selected code in an editor: adding it to the chat is the next step.
  // "Add to context" only works while the editor has focus.
  const add = ctx.away && ctx.selection ? hint(kb.addToContext, "addSelection") : undefined
  if (add) return add

  // Focus is somewhere else: show how to get back to the prompt.
  if (!ctx.focused) return hint(kb.focusChatInput, "type")

  // The agent is running. When another session is open the user can work on it
  // meanwhile; otherwise the useful key is to stop the run.
  if (ctx.busy) return sessions(kb, ctx.tabs) ?? { binding: "Esc", label: "stop" }
  return sessions(kb, ctx.tabs)
}
