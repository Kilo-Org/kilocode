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

/** Carry the panel-local dropdown choice with every Run click. */
export function resolveRunScriptRequest(worktreeId: string, destination: TerminalDestination) {
  return { type: "agentManager.runScript" as const, worktreeId, destination }
}

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
  ensureSide(): void
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
  /** Platform override for tests; the workbench keybinding is Cmd on
   *  macOS and Ctrl elsewhere, and the local fallback must match it. */
  mac?: boolean
}

export function createSideTerminal(deps: SideTerminalDeps) {
  const [local, setLocal] = createSignal<TerminalDestination | undefined>(deps.saved)
  const [destination, setDestination] = createSignal<TerminalDestination>(deps.saved ?? "vscode")
  if (deps.saved) deps.postMessage({ type: "agentManager.terminal.destinationSelected", destination: deps.saved })

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

  /** Keep an open terminal panel useful when its worktree context changes. */
  const syncContext = (key: string, previous: string | undefined) => {
    if (key === previous || !deps.visible()) return
    queueMicrotask(() => {
      if (deps.visible()) deps.handlers.ensureSide()
    })
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
   * setting. The provider still persists it as the default for new panels,
   * while setup uses this panel-local value immediately.
   */
  const choose = (target: TerminalDestination) => {
    deps.track("terminal_destination", "tab_toolbar", { destination: target })
    setLocal(target)
    setDestination(target)
    deps.save(target)
    deps.postMessage({ type: "agentManager.terminal.destinationSelected", destination: target })
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

  /**
   * Cmd/Ctrl+/ pressed while the webview holds DOM focus. VS Code normally
   * forwards the keybinding to the workbench too, and the extension echoes
   * it back as a showTerminal action message; `echo()` consumes one pending
   * echo per press so one keypress never toggles twice while an unrelated
   * invocation (command palette, terminal-focused press) still runs.
   * Handling the key locally keeps the shortcut working when the
   * forwarding path drops it (e.g. the chat prompt input is focused).
   * The modifier matches the declared keybinding: Cmd on macOS, Ctrl
   * elsewhere — accepting both would hijack the other platform's combo
   * (and any user keybinding on it) without a matching workbench binding.
   */
  const mac = deps.mac ?? (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent))
  let pending = 0
  let lastPress = 0
  const ECHO_MS = 500

  const press = (e: KeyboardEvent): boolean => {
    const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
    if (e.key !== "/" || e.shiftKey || e.altKey || !mod) return false
    // An echo either arrives promptly or never; drop the backlog of a
    // dropped echo so it cannot swallow a later unrelated invocation.
    if (Date.now() - lastPress > ECHO_MS) pending = 0
    pending++
    lastPress = Date.now()
    openPreferred("keyboard_shortcut")
    return true
  }

  /** Consumes one pending extension echo of a local `press`. The timeout is
   *  only a safety valve for an echo that never arrives; an echo that
   *  outlasts it is indistinguishable from a real invocation and must run. */
  const echo = () => {
    if (pending === 0) return false
    if (Date.now() - lastPress > ECHO_MS) {
      pending = 0
      return false
    }
    pending--
    return true
  }

  return { destination, syncDefault, syncContext, toggle, close, openPreferred, choose, press, echo }
}
