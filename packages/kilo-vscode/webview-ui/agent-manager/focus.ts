/** Focus the first enabled option in the visible question dock, if one exists. */
export function focusQuestionOption(root: ParentNode = document): boolean {
  for (const option of root.querySelectorAll<HTMLButtonElement>("button")) {
    if (option.getAttribute("data-slot") !== "question-option" || option.disabled) continue
    let parent: Element | null = option
    let dock = false
    let inert = false
    while (parent) {
      if (parent.getAttribute("data-component") === "question-dock") dock = true
      if (parent.hasAttribute("inert")) inert = true
      parent = parent.parentElement
    }
    if (!dock || inert) continue
    option.focus({ preventScroll: true })
    return true
  }
  return false
}
