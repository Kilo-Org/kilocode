/**
 * Ambient setup reveal for the side terminal panel.
 *
 * A worktree setup script runs automatically during provisioning, so the
 * side panel opens itself to show live progress. On a clean exit the
 * panel hides again and restores the previous layout; failures stay
 * visible. Any user engagement with the panel (explicit open/close,
 * adding or closing a terminal) cancels the pending auto-hide, so user
 * content is never pulled away. The exited Setup tab itself stays in
 * terminal state and can be reopened anytime.
 */

import { createEffect, createSignal, type Accessor } from "solid-js"
import type { ScriptTerminalStatus, TerminalStateControls } from "./state"
import type { TerminalTabStateWithContext } from "./state"
import type { SidePanelState } from "../AgentManagerApp"

interface AmbientSetupDeps {
  terms: TerminalStateControls
  selection: Accessor<string | null>
  sidePanel: Accessor<SidePanelState>
  setSidePanel(panel: null): void
}

export type AmbientDecision = "wait" | "hide" | "keep"

/** The detail stack hosts chat, terminals, and the read-only banner.
 *  It shows for any selected context (local/worktree) and for an
 *  unassigned session, where `selection` is null but the context is not
 *  empty (a live session is showing). The history view is exclusive. */
export function showTerminalStack(history: boolean, selection: string | null, contextEmpty: boolean): boolean {
  return !history && (selection !== null || !contextEmpty)
}

/** Setup output owns progress/error presentation when its terminal exists. */
export function hasSetupTerminal(selection: string | null, terminals: TerminalTabStateWithContext[]): boolean {
  return selection !== null && terminals.some((term) => term.contextKey === selection && term.kind === "setup")
}

/**
 * What happens to an ambiently revealed panel when the setup status
 * changes: still running means wait, failure or a context switch means
 * keep the panel as it is, a clean exit restores the previous layout.
 */
export function ambientDecision(
  status: ScriptTerminalStatus | undefined,
  selection: string | null,
  contextKey: string,
): AmbientDecision {
  if (!status || status.state === "running" || status.state === "stopping") return "wait"
  if (status.state !== "exited" || status.exitCode !== 0) return "keep"
  // The user moved on to another context; the panel shows other content.
  if (selection !== contextKey) return "keep"
  return "hide"
}

export function createAmbientSetup(deps: AmbientSetupDeps) {
  const [pending, setPending] = createSignal<{ contextKey: string; terminalId: string } | undefined>()

  createEffect(() => {
    const ambient = pending()
    if (!ambient) return
    // The terminal was removed (e.g. deliberately stopped); nothing to hide.
    if (!deps.terms.sides().some((term) => term.id === ambient.terminalId)) {
      setPending(undefined)
      return
    }
    const decision = ambientDecision(deps.terms.scriptStatus(ambient.terminalId), deps.selection(), ambient.contextKey)
    if (decision === "wait") return
    setPending(undefined)
    if (decision === "hide") deps.setSidePanel(null)
  })

  return {
    /** Called when a running setup terminal hydrates: reveal is ambient only if the panel was closed. */
    reveal(contextKey: string, terminalId: string): void {
      if (deps.sidePanel() === null) setPending({ contextKey, terminalId })
    },
    /** User engagement with the panel cancels the pending auto-hide. */
    cancel(): void {
      setPending(undefined)
    },
    /** Test hook: the pending ambient reveal, if any. */
    pending,
  }
}
