const OPTION = '[data-component="question-dock"] button[data-slot="question-option"]'

export function createChatFocus(deps: {
  term: () => string | undefined
  history: () => boolean
  review: () => boolean
}) {
  const focus = (force: boolean) => {
    if ((!force && !document.hasFocus()) || deps.term() || deps.history() || deps.review()) return
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

/** Return whether the visible question dock has an enabled option to focus. */
export function hasQuestionOption(root: ParentNode = document): boolean {
  for (const option of root.querySelectorAll<HTMLButtonElement>(OPTION)) {
    if (!option.disabled && !option.closest("[inert]")) return true
  }
  return false
}

/** Focus the first enabled option in the visible question dock, if one exists. */
export function focusQuestionOption(root: ParentNode = document): boolean {
  for (const option of root.querySelectorAll<HTMLButtonElement>(OPTION)) {
    if (option.disabled || option.closest("[inert]")) continue
    option.focus({ preventScroll: true })
    return true
  }
  return false
}
