import type { Component } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { LanguageContextValue } from "../src/context/language"
import type { CaffeinationState } from "../src/types/messages"
import "./CaffeinationButton.css"

interface Props {
  t: LanguageContextValue["t"]
  state: () => CaffeinationState
  onToggle: () => void
}

export const CaffeinationButton: Component<Props> = (props) => {
  const label = () => {
    const state = props.state()
    if (state.error) return state.error
    if (!state.available) return props.t("agentManager.caffeination.unavailable")
    if (state.active) return props.t("agentManager.caffeination.active")
    if (state.enabled) return props.t("agentManager.caffeination.armed")
    return props.t("agentManager.caffeination.toggle")
  }

  return (
    <Tooltip value={label()} placement="bottom">
      <IconButton
        icon="coffee"
        size="small"
        variant="ghost"
        classList={{ "am-caffeination-active": props.state().active }}
        aria-label={label()}
        aria-pressed={props.state().enabled || props.state().active}
        disabled={!props.state().available && !props.state().enabled && !props.state().active}
        onClick={props.onToggle}
      />
    </Tooltip>
  )
}
