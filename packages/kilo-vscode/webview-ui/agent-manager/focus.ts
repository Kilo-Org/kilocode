import { focusQuestionOption, hasPopup, hasQuestionOption, isTextControl, ownsFocusRegion } from "../src/utils/focus"

export type AgentManagerFocusTarget = "prompt" | "mainTerminal" | "sideTerminal" | "other"

export function forgetTerminalFocus(memory: Map<string, "prompt" | { terminal: string }>, id: string): void {
  for (const [key, owner] of memory) if (owner !== "prompt" && owner.terminal === id) memory.delete(key)
}

/**
 * A main terminal tab belongs to one context. When the selection moves without the tab restore (a new worktree, a
 * session another context reports), the terminal of the previous context must not stay active over the new one,
 * where it covers the chat and keeps every focus request away from the composer.
 */
export function dropForeignTerminal(terms: {
  activeId: () => string | undefined
  setActiveId: (id: undefined) => void
  contextFor: (id: string) => string | undefined
  currentKey: () => string | undefined
}): void {
  const id = terms.activeId()
  if (id && terms.contextFor(id) !== terms.currentKey()) terms.setActiveId(undefined)
}

/**
 * What a visible terminal does when its activation or focus request changes. Focus requests share one slot, so a
 * request for another terminal resets this terminal's serial to 0: that is not a request to focus it again, otherwise
 * the main terminal takes focus back from the side terminal that was just requested.
 */
export function terminalActivation(input: {
  active: boolean
  wasActive: boolean
  serial: number
  previous: number
  focusOnActivate: boolean
}): { focus: boolean } | undefined {
  if (!input.active) return undefined
  const requested = input.serial > 0 && input.serial !== input.previous
  if (input.wasActive && !requested) return undefined
  return { focus: requested || input.focusOnActivate }
}

/** Resolve focus from the current DOM owner, not focus event order. */
export function agentManagerFocusTarget(active: Element | null, promptPending = false): AgentManagerFocusTarget {
  if (promptPending || active?.matches("textarea.prompt-input")) return "prompt"
  if (active?.closest(".am-side-terminal-layer .am-terminal-host")) return "sideTerminal"
  if (active?.closest(".am-terminal-layer .am-terminal-host")) return "mainTerminal"
  return "other"
}

/**
 * The main tab of the visible context owns explicit focus requests: a terminal tab keeps or takes focus in its
 * terminal, a session tab focuses its composer. Nothing switches tabs or creates a session to have a focus target.
 */
export function createMainFocus(deps: {
  terminal: () => string | undefined
  focusTerminal: (id: string) => void
  prompt: (force: boolean) => void
  /** An automatic request (window focus, context switch) leaves another control in charge. */
  keeps?: () => boolean
}) {
  return (force = false): "mainTerminal" | "prompt" => {
    const id = deps.terminal()
    if (id) {
      if (!force && deps.keeps?.()) return "mainTerminal"
      deps.focusTerminal(id)
      return "mainTerminal"
    }
    deps.prompt(force)
    return "prompt"
  }
}

/**
 * Another control owns the keyboard: a text field such as the sidebar search or a worktree rename, a popup, or a
 * focus region such as the diff viewport. A terminal does not count, since the request picks between terminals.
 */
export function keepsFocus(active: Element | null): boolean {
  if (terminalHasFocus(active)) return false
  return hasPopup() || ownsFocusRegion() || (active !== null && isTextControl(active))
}

/** A main or side terminal holds the keyboard: chat shortcuts must not act on the composer behind it. */
export const terminalHasFocus = (active: Element | null): boolean => {
  const target = agentManagerFocusTarget(active)
  return target === "mainTerminal" || target === "sideTerminal"
}

export function createFocusBridge(deps: {
  prompt: { active: () => boolean; focus: () => void }
  post: (target: AgentManagerFocusTarget) => void
  remember: () => void
  terminal: () => string | undefined
  focusTerminal: (id: string) => void
}) {
  const main = createMainFocus({ terminal: deps.terminal, focusTerminal: deps.focusTerminal, prompt: deps.prompt.focus })
  const report = () => {
    const active = agentManagerFocusTarget(document.activeElement)
    deps.post(
      active === "mainTerminal" || active === "sideTerminal"
        ? active
        : agentManagerFocusTarget(document.activeElement, deps.prompt.active()),
    )
  }
  return {
    report,
    prompt: (focused: boolean) => {
      if (focused) deps.remember()
      report()
    },
    focus: () => deps.post(main(true)),
  }
}

/** Keep an active editor, such as the worktree rename input, in control. */
export const preservesTextFocus = (active: Element | null): boolean =>
  active !== null && isTextControl(active) && !active.classList.contains("prompt-input")

export function createChatFocus(deps: {
  term: () => string | undefined
  history: () => boolean
  review: () => boolean
}) {
  const focus = (force: boolean) => {
    if ((!force && (!document.hasFocus() || deps.term())) || deps.history() || deps.review()) return
    // A focused diff viewport keeps focus; delayed prompt recovery must not steal it.
    if (!force && ownsFocusRegion()) return
    if (hasPopup()) return
    if (preservesTextFocus(document.activeElement) || (!force && isTextControl(document.activeElement))) return
    if (!force && document.activeElement?.matches('[role="tab"]')) return
    if (!force && document.activeElement?.closest('[data-component="question-dock"]')) return
    if (focusQuestionOption()) return
    const defer = hasQuestionOption()
    window.dispatchEvent(
      new CustomEvent("focusPrompt", {
        detail: { restore: !defer, deferFocusToQuestion: defer, force },
      }),
    )
  }
  return (force = false) => {
    queueMicrotask(() => focus(force))
    requestAnimationFrame(() => {
      focus(false)
      requestAnimationFrame(() => {
        focus(false)
        requestAnimationFrame(() => focus(false))
      })
    })
  }
}

export function createPromptFocus(
  terms: { setActiveId: (id: undefined) => void; setFocusedId: (id: undefined) => void },
  focus: (force?: boolean) => void,
) {
  let until = 0
  return {
    active: () => Date.now() < until,
    focus: () => {
      until = Date.now() + 500
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      terms.setActiveId(undefined)
      terms.setFocusedId(undefined)
      focus(true)
    },
  }
}

