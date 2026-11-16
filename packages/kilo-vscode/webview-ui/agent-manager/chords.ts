/**
 * Which modifier chords belong to the Agent Manager. Its shortcuts use Cmd on macOS and Ctrl elsewhere, like the
 * workbench keybindings in package.json. On macOS a Ctrl chord stays with the focused control: the terminal receives
 * Ctrl+E, Ctrl+W or Ctrl+D, and the composer keeps the native Ctrl+E or Ctrl+F caret movement.
 */
type Chord = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">

const ARROWS = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright"])
const COMMAND = new Set(["t", "w", "n", "d", "e", "f"])
const COMMAND_SHIFT = new Set(["t", "m", "w", "n", "o", "r", "f", "[", "]", "/", "?"])

const primary = (event: Chord, mac: boolean) => (mac ? event.metaKey : event.ctrlKey || event.metaKey)

/** An Agent Manager shortcut whose browser default (new window, find, close) must not run. */
export function blocksBrowserDefault(event: Chord, mac: boolean): boolean {
  if (!primary(event, mac)) return false
  const key = event.key.toLowerCase()
  if (event.altKey && ARROWS.has(key)) return true
  if (!event.shiftKey && COMMAND.has(key)) return true
  if (event.shiftKey && COMMAND_SHIFT.has(key)) return true
  return /^[1-9]$/.test(key)
}

/** A chord the focused xterm hands to the Agent Manager instead of sending it to the shell. */
export function leavesTerminal(event: Chord, mac: boolean): boolean {
  if (!primary(event, mac)) return false
  const key = event.key.toLowerCase()
  if (event.altKey && ARROWS.has(key)) return true
  if (COMMAND.has(key)) return true
  if (event.shiftKey && COMMAND_SHIFT.has(key)) return true
  return /^[1-9]$/.test(key) || key === "/"
}

/** The Agent Manager focus shortcut (Cmd+Shift+M on macOS, Ctrl+Shift+M elsewhere). */
export function isFocusChord(event: Chord, mac: boolean): boolean {
  return primary(event, mac) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "m"
}
