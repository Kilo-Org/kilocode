// Send keys shared by the PR panel. The panel has no composer, so each section and each send button answers the
// chords the composer uses: ⌥/Alt+Enter sends the way an Option-click does, mirroring ⌥↵ in the composer. ⌘/Ctrl+Enter
// keeps whatever plain submit the surface already had.

/** Whether the event is ⌥/Alt+Enter, the alternate send. */
export function isAltEnter(event: KeyboardEvent): boolean {
  return event.key === "Enter" && event.altKey && !event.metaKey && !event.ctrlKey
}

/** Whether the key event belongs to a text control, such as a reply form, that owns Enter itself. */
function inTextField(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return true
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || !!target.closest("textarea, input, [contenteditable='true']")
}

/**
 * Runs a send for ⌥/Alt+Enter. A focused card or section handles it before its container, so the innermost send
 * wins and Enter keeps its meaning inside text controls.
 */
export function altEnterSend(event: KeyboardEvent, run: () => void): void {
  if (!isAltEnter(event) || inTextField(event.target)) return
  event.preventDefault()
  event.stopPropagation()
  run()
}
