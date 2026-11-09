import { forwardKey } from "../src/utils/caret"

/** Prevent Cmd/Ctrl shortcuts from triggering native browser actions. */
export function block(target: Window, mac: boolean) {
  const key = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return
    const el = e.target as HTMLElement | null
    if (el?.closest("[data-agent-manager-native-text-shortcuts]")) return
    // macOS Ctrl+F moves the caret in text fields. Search is Cmd+F there, and
    // VSCodeProvider moves the caret after VS Code's preload cancels the key.
    if (forwardKey(e, mac)) return
    // Arrow navigation requires Alt modifier (Cmd+Alt+Arrow for tabs/sessions)
    if (e.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault()
    }
    // Prevent browser defaults for our shortcuts (new tab, close tab, new window, toggle diff, run, find)
    if (["t", "w", "n", "d", "e", "f"].includes(e.key.toLowerCase()) && !e.shiftKey) {
      e.preventDefault()
    }
    // Prevent browser defaults for shift variants (new central terminal,
    // close worktree, advanced/new/open worktree, open PR, terminal cycling)
    if (["t", "m", "w", "n", "o", "r", "[", "]"].includes(e.key.toLowerCase()) && e.shiftKey) {
      e.preventDefault()
    }
    // Prevent browser defaults for shortcuts help (Cmd/Ctrl+Shift+/)
    if (["/", "?"].includes(e.key) && e.shiftKey) {
      e.preventDefault()
    }
    // Prevent defaults for jump-to shortcuts (Cmd/Ctrl+1-9)
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault()
    }
  }
  target.addEventListener("keydown", key, true)
  return () => target.removeEventListener("keydown", key, true)
}
