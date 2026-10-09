/**
 * Terminal tab id helpers shared by the Agent Manager and the sidebar.
 *
 * These are pure string helpers so any tab bar can tell a terminal tab from a
 * session or review tab without importing Agent Manager terminal state.
 */

/** Prefix used for terminal tab IDs in the webview (mirrors terminal-manager.ts). */
export const TERMINAL_PREFIX = "terminal:"
export const SCRIPT_TERMINAL_PREFIX = "script:"

export const isTerminalTabId = (id: string): boolean =>
  id.startsWith(TERMINAL_PREFIX) || id.startsWith(SCRIPT_TERMINAL_PREFIX)
