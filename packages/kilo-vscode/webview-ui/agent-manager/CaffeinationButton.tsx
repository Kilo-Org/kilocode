import { createSignal, onCleanup, onMount, type Component } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useVSCode } from "../src/context/vscode"
import type { LanguageContextValue } from "../src/context/language"
import type { CaffeinationState } from "../src/types/messages"
import "./CaffeinationButton.css"

export const CaffeinationButton: Component<{ t: LanguageContextValue["t"] }> = (props) => {
  const vscode = useVSCode()
  const [state, setState] = createSignal<CaffeinationState>({ enabled: false, active: false, available: false })
  onCleanup(
    vscode.onMessage((message) => {
      if (message.type === "agentManager.caffeination") setState(message)
    }),
  )
  onMount(() => vscode.postMessage({ type: "agentManager.requestCaffeination" }))
  const label = () => {
    const value = state()
    if (value.error) return value.error
    if (!value.available) return props.t("agentManager.caffeination.unavailable")
    if (value.active) return props.t("agentManager.caffeination.active")
    if (value.enabled) return props.t("agentManager.caffeination.armed")
    return props.t("agentManager.caffeination.toggle")
  }
  return (
    <Tooltip value={label()} placement="bottom">
      <IconButton
        icon="coffee"
        size="small"
        variant="ghost"
        classList={{ "am-caffeination-active": state().active }}
        aria-label={label()}
        aria-pressed={state().enabled || state().active}
        disabled={!state().available && !state().enabled && !state().active}
        onClick={() =>
          vscode.postMessage({ type: "agentManager.setCaffeination", enabled: !(state().enabled || state().active) })
        }
      />
    </Tooltip>
  )
}
