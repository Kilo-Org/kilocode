const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

const MAX_JUMP_INDEX = 9

/** Fallback keybindings before the extension sends resolved ones. */
export const defaultBindings: Record<string, string> = {
  previousSession: isMac ? "⌘⌥↑" : "Ctrl+Alt+↑",
  nextSession: isMac ? "⌘⌥↓" : "Ctrl+Alt+↓",
  previousTab: isMac ? "⌘⌥←" : "Ctrl+Alt+←",
  nextTab: isMac ? "⌘⌥→" : "Ctrl+Alt+→",
  previousTerminal: isMac ? "⌘⇧[" : "Ctrl+Shift+[",
  nextTerminal: isMac ? "⌘⇧]" : "Ctrl+Shift+]",
  search: isMac ? "⌘F" : "Ctrl+F",
  showTerminal: isMac ? "⌘/" : "Ctrl+/",
  newTerminal: isMac ? "⌘⇧T" : "Ctrl+Shift+T",
  runScript: isMac ? "⌘E" : "Ctrl+E",
  toggleDiff: isMac ? "⌘D" : "Ctrl+D",
  showShortcuts: isMac ? "⌘⇧/" : "Ctrl+Shift+/",
  newTab: isMac ? "⌘T" : "Ctrl+T",
  closeTab: isMac ? "⌘W" : "Ctrl+W",
  newWorktree: isMac ? "⌘N" : "Ctrl+N",
  quickWorktree: isMac ? "⌘⇧N" : "Ctrl+Shift+N",
  closeWorktree: isMac ? "⌘⇧W" : "Ctrl+Shift+W",
  openWorktree: isMac ? "⌘⇧O" : "Ctrl+Shift+O",
  openPR: isMac ? "⌘⇧R" : "Ctrl+Shift+R",
  agentManagerOpen: isMac ? "⌘⇧M" : "Ctrl+Shift+M",
  cycleAgentMode: isMac ? "⌘." : "Ctrl+.",
  cyclePreviousAgentMode: isMac ? "⌘⇧." : "Ctrl+Shift+.",
  ...Object.fromEntries(
    Array.from({ length: MAX_JUMP_INDEX }, (_, i) => [`jumpTo${i + 1}`, isMac ? `⌘${i + 1}` : `Ctrl+${i + 1}`]),
  ),
}
