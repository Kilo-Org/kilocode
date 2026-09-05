import { hasPopup, isTextControl } from "../src/utils/focus"

const OPTION = '[data-component="question-dock"] button[data-slot="question-option"]'

export type AgentManagerFocusTarget = "prompt" | "mainTerminal" | "sideTerminal" | "other"

export function forgetTerminalFocus(memory: Map<string, "prompt" | { terminal: string }>, id: string): void {
  for (const [key, owner] of memory) if (owner !== "prompt" && owner.terminal === id) memory.delete(key)
}

/** Resolve focus from the current DOM owner, not focus event order. */
export function agentManagerFocusTarget(active: Element | null, promptPending = false): AgentManagerFocusTarget {
  if (promptPending || active?.matches("textarea.prompt-input")) return "prompt"
  if (active?.closest(".am-side-terminal-layer .am-terminal-host")) return "sideTerminal"
  if (active?.closest(".am-terminal-layer .am-terminal-host")) return "mainTerminal"
  return "other"
}

export function createFocusBridge(deps: {
  prompt: { active: () => boolean; focus: () => void }
  post: (target: AgentManagerFocusTarget) => void
  remember: () => void
  restore: () => "none" | "ready" | "pending"
}) {
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
    focus: () => {
      if (deps.restore() === "pending") return
      deps.post("prompt")
      deps.prompt.focus()
    },
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
    if (hasPopup()) return
    if (preservesTextFocus(document.activeElement) || (!force && isTextControl(document.activeElement))) return
    if (!force && document.activeElement?.matches('[role="tab"]')) return
    if (!force && document.activeElement?.closest('[data-component="question-dock"]')) return
    if (focusQuestionOption()) return
    const defer = hasQuestionOption()
    window.dispatchEvent(
      new CustomEvent("focusPrompt", {
        detail: { restore: !defer, deferFocusToQuestion: defer },
      }),
    )
  }
  return (force = false) => {
    queueMicrotask(() => focus(force))
    requestAnimationFrame(() => {
      focus(force)
      requestAnimationFrame(() => {
        focus(force)
        requestAnimationFrame(() => focus(force))
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

/** Return whether the visible question dock has an enabled option to focus. */
export function hasQuestionOption(root: ParentNode = document): boolean {
  for (const option of root.querySelectorAll<HTMLButtonElement>(OPTION)) {
    if (!option.disabled && !option.closest("[inert]")) return true
  }
  return false
}

/** Focus the first enabled option in the visible question dock, if one exists. */
export function focusQuestionOption(root: ParentNode = document): boolean {
  const options = [...root.querySelectorAll<HTMLButtonElement>(OPTION)].filter(
    (option) => !option.disabled && !option.closest("[inert]"),
  )
  const option = options.find((option) => option.dataset.picked === "true") ?? options.at(0)
  if (!option) return false
  option.focus({ preventScroll: true })
  return true
}
