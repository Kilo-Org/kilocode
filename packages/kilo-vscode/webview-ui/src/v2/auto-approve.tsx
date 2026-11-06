// Auto-approve for permission requests, ported from v1's composer toggle
// (packages/kilo-vscode/src/commands/toggle-auto-approve.ts on main). The host owns the sweep of every permission
// event, so it covers sessions in directories this webview does not show, including while no panel is open. This
// webview only renders the toggle and persists the on/off state.
import { createSignal, onCleanup } from "solid-js"
import { useVSCode } from "../context/vscode"

export function createAutoApprove() {
  const vscode = useVSCode()
  const [enabled, setEnabled] = createSignal(false)

  onCleanup(
    vscode.onMessage((message) => {
      if (message.type === "autoApproveStateLoaded") setEnabled(message.value)
    }),
  )
  vscode.postMessage({ type: "requestAutoApproveState" })

  return {
    enabled,
    toggle() {
      const value = !enabled()
      setEnabled(value)
      vscode.postMessage({ type: "persistAutoApproveState", value })
    },
  }
}
