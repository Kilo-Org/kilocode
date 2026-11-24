import { isFocusChord, leavesTerminal } from "../chords"

export type TerminalKeyEvent = Pick<KeyboardEvent, "type" | "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">

export interface TerminalKeyHandlerDeps {
  mac: boolean
  hasSelection: () => boolean
  onCopy: () => void
  onSelectAll: () => void
  onFocusPrompt?: () => void
  sendInput: (data: string) => void
}

/**
 * Custom key event handler for ghostty-web's `attachCustomKeyEventHandler`.
 *
 * ghostty-web treats a `true` return value as "consumed": it calls
 * calls `event.preventDefault()` and skips PTY encoding while letting the event
 * bubble up to window-level Agent Manager shortcut handlers. Returning `false`
 * lets ghostty-web handle the key normally.
 */
export function createTerminalKeyHandler(deps: TerminalKeyHandlerDeps): (event: TerminalKeyEvent) => boolean {
  return (event) => {
    if (isFocusChord(event, deps.mac)) {
      if (event.type === "keydown") deps.onFocusPrompt?.()
      return true
    }

    if (leavesTerminal(event, deps.mac)) return true

    if (deps.mac) {
      // ghostty-web skips `ctrl+KeyV` to allow native paste on non-Mac platforms;
      // on macOS Ctrl+V belongs to the shell/editor (e.g., Vim visual block, quoted-insert).
      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.code === "KeyV") {
        deps.sendInput("\x16")
        return true
      }

      if (event.metaKey && !event.ctrlKey && !event.altKey) {
        return handleMacMetaKey(event, deps)
      }
      return false
    }

    if (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && event.code === "KeyC") {
      if (deps.hasSelection()) {
        deps.onCopy()
        return true
      }
    }

    return false
  }
}

function handleMacMetaKey(event: TerminalKeyEvent, deps: TerminalKeyHandlerDeps): boolean {
  if (!event.shiftKey && event.key === "Backspace") {
    deps.sendInput("\x15")
    return true
  }

  // Leave physical KeyV alone so the browser fires its native paste event.
  if (event.code === "KeyV") return false

  if (!event.shiftKey && event.code === "KeyC") {
    if (deps.hasSelection()) deps.onCopy()
    return true
  }

  if (!event.shiftKey && event.code === "KeyA") {
    deps.onSelectAll()
    return true
  }

  // Consume unhandled Cmd+<char> chords so ghostty-web never forwards raw
  // printable characters to the shell when the user presses a workbench chord.
  return event.key.length === 1
}
