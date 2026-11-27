// Auto-approve for permission requests, ported from v1's composer toggle
// (packages/kilo-vscode/src/commands/toggle-auto-approve.ts on main). The host owns the sweep of every permission
// event, so it covers sessions in directories this webview does not show, including while no panel is open. This
// webview only renders the toggle and persists the on/off state.
import { createSignal, onCleanup } from "solid-js"
import { useVSCode } from "../context/vscode"

// The last state the host sent. A composer remounted for another worktree shows the toggle as the user left it
// instead of dropping its on state until the next reply.
let lastEnabled: boolean | undefined

function initialAutoApprove(): boolean | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as { KILO_INITIAL_STATE?: { autoApprove?: boolean } }).KILO_INITIAL_STATE?.autoApprove
}

export function createAutoApprove() {
  const vscode = useVSCode()
  const seeded = lastEnabled ?? initialAutoApprove()
  const [enabled, setEnabled] = createSignal(seeded ?? false)

  onCleanup(
    vscode.onMessage((message) => {
      if (message.type !== "autoApproveStateLoaded") return
      lastEnabled = message.value
      setEnabled(message.value)
    }),
  )
  if (seeded === undefined) vscode.postMessage({ type: "requestAutoApproveState" })

  return {
    enabled,
    toggle() {
      const value = !enabled()
      lastEnabled = value
      setEnabled(value)
      vscode.postMessage({ type: "persistAutoApproveState", value })
    },
  }
}
