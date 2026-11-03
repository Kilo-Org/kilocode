// Auto-approve for permission requests, ported from v1's composer toggle
// (packages/kilo-vscode/src/commands/toggle-auto-approve.ts on main). The host owns the sweep of every permission
// event, so it covers sessions in directories this webview does not show, including while no panel is open. This
// webview only renders the toggle and persists the on/off state.
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { createSignal, onCleanup } from "solid-js"
import { useLanguage } from "../context/language"
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

export function AutoApproveAction(props: { enabled: boolean; onToggle: () => void }) {
  const language = useLanguage()
  const label = () =>
    props.enabled ? language.t("prompt.action.autoApprove.disable") : language.t("prompt.action.autoApprove.enable")
  const tooltip = () =>
    `${language.t(props.enabled ? "prompt.action.autoApprove.enabled" : "prompt.action.autoApprove.disabled")} ${language.t("prompt.action.autoApprove.sandboxExcluded")}`
  return (
    <div class="prompt-action">
      <Tooltip value={tooltip()} placement="top" openDelay={0}>
        <IconButton
          icon="shield"
          variant="ghost"
          size="small"
          onClick={props.onToggle}
          aria-label={label()}
          aria-pressed={props.enabled}
          class="prompt-status-button"
          classList={{ "prompt-status-button--active": props.enabled }}
        />
      </Tooltip>
    </div>
  )
}
