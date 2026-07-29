/**
 * Right-side terminal wiring for the Agent Manager webview.
 *
 * Extracted from AgentManagerApp.tsx to keep that file under the
 * `max-lines` lint cap. Owns the destination preference plus the toggle
 * semantics of the toolbar button / `Cmd/Ctrl+/` shortcut, so the
 * embedded terminal behaves like the diff panel: press once to reveal,
 * press again to hide. Hiding never kills the terminal — only the
 * explicit close action (or `Cmd+W` while it holds focus) does.
 *
 * ## Destination state ownership
 *
 * The VS Code setting is application-scoped, so one value is shared by
 * every window and echoed back via `terminal.destinationChanged`
 * whenever ANY window rewrites it. Two windows can therefore fight:
 * picking "VS Code terminal" in worktree window B would silently flip
 * the routing of the panel in window A. To keep each panel consistent,
 * an explicit dropdown pick is stored per panel (webview state) and
 * wins over remote echoes; the setting only drives panels that never
 * picked a destination themselves (it stays the default for new ones).
 */

import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import type { TerminalDestination } from "../../src/types/messages/agent-manager"
import { LOCAL } from "../navigate"

/** Read the panel-local destination choice from raw webview state. */
export function readSavedDestination(state: Record<string, unknown> | undefined): TerminalDestination | undefined {
  const value = state?.terminalDestination
  return value === "agentManager" || value === "vscode" ? value : undefined
}

export type VscodeTerminalRequest =
  | { type: "agentManager.showTerminal"; sessionId: string }
  | { type: "agentManager.showWorktreeTerminal"; worktreeId: string }
  | { type: "agentManager.showLocalTerminal" }

/**
 * Pick the message the terminal button / Focus Terminal shortcut sends
 * when the destination is the VS Code integrated terminal. The fallback
 * chain exists so the shortcut never dead-ends: activating a terminal
 * tab clears the current session, and a worktree may have no sessions
 * at all. Extracted from AgentManagerApp.tsx (max-lines cap).
 */
export function resolveVscodeTerminalRequest(
  selection: string | null,
  currentSessionID: string | undefined,
  sessionForWorktree: (worktreeId: string) => string | undefined,
): VscodeTerminalRequest {
  const id = currentSessionID ?? (selection && selection !== LOCAL ? sessionForWorktree(selection) : undefined)
  if (id) return { type: "agentManager.showTerminal", sessionId: id }
  if (selection && selection !== LOCAL) return { type: "agentManager.showWorktreeTerminal", worktreeId: selection }
  return { type: "agentManager.showLocalTerminal" }
}

interface Handlers {
  requestSide(): void
  closeSide(terminalId: string): boolean
}

export interface SideTerminalDeps {
  handlers: Handlers
  /** True while the right-side inspector shows the terminal. */
  visible: Accessor<boolean>
  /** Id of the side terminal holding DOM focus, if any. */
  focusedId: Accessor<string | undefined>
  /** Leave terminal mode; the terminal stays alive in the background. */
  hide: () => void
  /** Move focus back to the chat composer. */
  refocus: () => void
  postMessage: (msg: unknown) => void
  track: (button: string, surface: string, properties: Record<string, string>) => void
  /** Open or focus the VS Code integrated terminal for the active context. */
  openVscode: () => void
  /** Panel-local choice restored from webview state, if the user ever
   *  picked one in this panel. */
  saved: TerminalDestination | undefined
  /** Persist the panel-local choice so it survives webview reloads. */
  save: (destination: TerminalDestination) => void
}

export function createSideTerminal(deps: SideTerminalDeps) {
  const [local, setLocal] = createSignal<TerminalDestination | undefined>(deps.saved)
  const [destination, setDestination] = createSignal<TerminalDestination>(deps.saved ?? "vscode")

  /**
   * Hiding while the terminal holds focus would strand the cursor on
   * <body>, so hand it to the chat composer — the common flow is
   * type → Cmd+/ → run command → Cmd+/ → keep typing. When the user
   * was anywhere else (chat, diff, another tab), focus stays put.
   */
  const handoff = (wasFocused: boolean) => {
    if (wasFocused) deps.refocus()
  }

  const toggle = () => {
    if (deps.visible()) {
      const was = deps.focusedId() !== undefined
      deps.hide()
      handoff(was)
      return
    }
    deps.handlers.requestSide()
  }

  /** Kill the focused side terminal (Cmd/Ctrl+W). The panel stays open
   *  on the remaining terminals, or on the empty state when this was
   *  the last one. */
  const close = (): boolean => {
    const id = deps.focusedId()
    if (!id) return false
    const done = deps.handlers.closeSide(id)
    if (done) handoff(true)
    return done
  }

  /** Toolbar button and `Cmd/Ctrl+/`: follow the user's destination. */
  const openPreferred = (trigger: "keyboard_shortcut" | "tab_toolbar") => {
    const target = destination()
    deps.track("terminal", trigger, { destination: target })
    if (target === "agentManager") {
      toggle()
      return
    }
    deps.openVscode()
  }

  /**
   * Dropdown pick. The choice is panel-local and sticky: it is kept in
   * webview state and beats later `terminal.destinationChanged` echoes
   * caused by other windows rewriting the shared application-scoped
   * setting. The setting is still written so it stays the default for
   * panels that never picked a destination (and new panels).
   * The key is relative to the `kilo-code.new` section, matching every
   * other `updateSetting` sender.
   */
  const choose = (target: TerminalDestination) => {
    deps.track("terminal_destination", "tab_toolbar", { destination: target })
    setLocal(target)
    setDestination(target)
    deps.save(target)
    deps.postMessage({ type: "updateSetting", key: "agentManager.terminalButtonDestination", value: target })
  }

  /**
   * Apply a remote default (initial `agentManager.state` payload or a
   * live `terminal.destinationChanged` echo). Ignored once the user
   * picked a destination in this panel — their choice wins over every
   * echo, including ones triggered by this panel's own `choose` write.
   */
  const syncDefault = (target: TerminalDestination) => {
    if (local()) return
    setDestination(target)
  }

  return { destination, syncDefault, toggle, close, openPreferred, choose }
}
