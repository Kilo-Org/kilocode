/**
 * Right-side terminal wiring for the Agent Manager webview.
 *
 * Extracted from AgentManagerApp.tsx to keep that file under the
 * `max-lines` lint cap. Owns the destination preference plus the toggle
 * semantics of the toolbar button / `Cmd/Ctrl+/` shortcut, so the
 * embedded terminal behaves like the diff panel: press once to reveal,
 * press again to hide. Hiding never kills the terminal — only the
 * explicit close action (or `Cmd+W` while it holds focus) does.
 */

import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import type { TerminalDestination } from "../../src/types/messages/agent-manager"

interface Handlers {
  requestSide(): void
  closeSide(): boolean
}

export interface SideTerminalDeps {
  handlers: Handlers
  /** True while the right-side inspector shows the terminal. */
  visible: Accessor<boolean>
  /** True while the side terminal itself holds DOM focus. */
  focused: Accessor<boolean>
  /** Leave terminal mode; the terminal stays alive in the background. */
  hide: () => void
  /** Move focus back to the chat composer. */
  refocus: () => void
  postMessage: (msg: unknown) => void
  track: (button: string, surface: string, properties: Record<string, string>) => void
  /** Open or focus the VS Code integrated terminal for the active context. */
  openVscode: () => void
}

export function createSideTerminal(deps: SideTerminalDeps) {
  const [destination, setDestination] = createSignal<TerminalDestination>("vscode")

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
      const was = deps.focused()
      deps.hide()
      handoff(was)
      return
    }
    deps.handlers.requestSide()
  }

  /** Kill the current context's side terminal (or cancel its in-flight
   *  create) and hide the panel. */
  const close = (): boolean => {
    const was = deps.focused()
    const done = deps.handlers.closeSide()
    if (done) handoff(was)
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
   * Dropdown pick. Applied locally right away so the button reacts
   * without a round trip, then persisted as a VS Code setting; the
   * extension echoes it back via `terminal.destinationChanged`.
   * The key is relative to the `kilo-code.new` section, matching every
   * other `updateSetting` sender.
   */
  const choose = (target: TerminalDestination) => {
    deps.track("terminal_destination", "tab_toolbar", { destination: target })
    setDestination(target)
    deps.postMessage({ type: "updateSetting", key: "agentManager.terminalButtonDestination", value: target })
  }

  return { destination, setDestination, toggle, close, openPreferred, choose }
}
