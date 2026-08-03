/** Focus the first enabled option in the visible question dock, if one exists. */
export function focusQuestionOption(root: ParentNode = document): boolean {
  for (const option of root.querySelectorAll<HTMLButtonElement>(
    '[data-component="question-dock"] button[data-slot="question-option"]',
  )) {
    if (option.disabled || option.closest("[inert]")) continue
    option.focus({ preventScroll: true })
    return true
  }
  return false
}
