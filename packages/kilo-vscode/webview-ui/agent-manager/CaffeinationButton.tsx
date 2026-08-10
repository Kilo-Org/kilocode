import type { Component } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { LanguageContextValue } from "../src/context/language"
import type { CaffeinationState } from "../src/types/messages"

interface Props {
  t: LanguageContextValue["t"]
  state: () => CaffeinationState
  onToggle: () => void
}

export const CaffeinationButton: Component<Props> = (props) => {
  const label = () => {
    const state = props.state()
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
        label={label()}
        aria-pressed={props.state().enabled}
        class={props.state().active ? "am-tab-diff-btn-active" : ""}
        disabled={!props.state().available}
        onClick={props.onToggle}
      />
    </Tooltip>
  )
}
