import { isTextControl } from "./focus"

// VS Code's webview preload cancels every Ctrl/Cmd+F keydown so the key can
// open the webview find widget. On macOS that also cancels the native Ctrl+F
// text binding, which moves the caret forward one character (#15013).
// Match keyCode like VS Code does so non-Latin layouts stay in lockstep.
export function forwardKey(e: KeyboardEvent, mac: boolean): boolean {
  if (!mac || e.defaultPrevented || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false
  if (e.keyCode !== 70 && e.key.toLowerCase() !== "f") return false
  const el = e.target as Element | null
  return el?.tagName !== "SELECT" && isTextControl(el)
}

// Selection.modify follows the native caret rules, including grapheme
// clusters and collapsing a selection to its end.
export function forward(e: KeyboardEvent, mac: boolean) {
  if (!forwardKey(e, mac)) return
  e.preventDefault()
  document.getSelection()?.modify("move", "forward", "character")
}
