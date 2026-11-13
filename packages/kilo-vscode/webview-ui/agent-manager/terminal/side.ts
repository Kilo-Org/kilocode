/**
 * Right-side terminal wiring for the Agent Manager webview.
 *
 * Extracted from AgentManagerApp.tsx to keep that file under the
 * `max-lines` lint cap. Owns the toggle semantics: the toolbar button
 * toggles visibility, while `Cmd/Ctrl+/` reveals, focuses when
 * unfocused, and hides when focused. Hiding never kills the terminal —
 * only the explicit close action does.
 */

import type { Accessor } from "solid-js"

interface Handlers {
  requestSide(): void
  ensureSide(): void
  closeSide(terminalId: string): boolean
}

export interface SideTerminalDeps {
  handlers: Handlers
  /** True while the right-side inspector shows the terminal. */
  visible: Accessor<boolean>
  /** Id of the side terminal holding DOM focus, if any. */
  focusedId: Accessor<string | undefined>
  /** Number of side terminals in the visible context. */
  count: Accessor<number>
  /** Whether the focused terminal is provider-owned Run/Setup output. */
  isScript: (terminalId: string) => boolean
  /** Leave terminal mode; the terminal stays alive in the background. */
  hide: () => void
  /** Move focus back to the chat composer. */
  refocus: () => void
  /** Platform override for tests; the workbench keybinding is Cmd on
   *  macOS and Ctrl elsewhere, and the local fallback must match it. */
  mac?: boolean
}

export function createSideTerminal(deps: SideTerminalDeps) {
  /**
   * Hiding while the terminal holds focus would strand the cursor on
   * <body>, so hand it to the chat composer — the common flow is
   * type → Cmd+/ → run command → Cmd+/ → keep typing. When the user
   * was anywhere else (chat, diff, another tab), focus stays put.
   */
  const handoff = (wasFocused: boolean) => {
    if (wasFocused) deps.refocus()
  }

  const toggle = (trigger: "keyboard_shortcut" | "tab_toolbar" = "keyboard_shortcut") => {
    if (deps.visible()) {
      if (trigger === "keyboard_shortcut" && !deps.focusedId()) {
        deps.handlers.requestSide()
        return
      }
      const was = deps.focusedId() !== undefined
      deps.hide()
      handoff(was)
      return
    }
    deps.handlers.requestSide()
  }

  /** Keep an open terminal panel useful when its worktree context changes. */
  const syncContext = (key: string, previous: string | undefined) => {
    if (key === previous || !deps.visible()) return
    queueMicrotask(() => {
      if (deps.visible()) deps.handlers.ensureSide()
    })
  }

  /** Leave the focused side terminal without killing its shell when it is
   *  the last terminal or provider-owned script output. */
  const close = (): boolean => {
    const id = deps.focusedId()
    if (!id) return false
    const only = deps.count() === 1
    if (only || deps.isScript(id)) {
      deps.hide()
      handoff(true)
      return true
    }
    return deps.handlers.closeSide(id)
  }

  /**
   * Cmd/Ctrl+/ pressed while the webview holds DOM focus, from a window
   * capture listener. The key is handled here and stopped, so VS Code does
   * not also run the workbench keybinding: its showTerminal command would
   * toggle the terminal a second time. Other invocations (command palette)
   * still arrive as a showTerminal action. A held key toggles once. The
   * modifier matches the declared keybinding: Cmd on macOS, Ctrl elsewhere.
   * Accepting both would hijack the other platform's combo (and any user
   * keybinding on it).
   */
  const mac = deps.mac ?? (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent))

  const press = (e: KeyboardEvent): boolean => {
    const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
    if (e.key !== "/" || e.shiftKey || e.altKey || !mod) return false
    e.preventDefault()
    e.stopPropagation()
    if (!e.repeat) toggle("keyboard_shortcut")
    return true
  }

  return { syncContext, toggle, close, press }
}
