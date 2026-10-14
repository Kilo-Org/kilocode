import { type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useLanguage } from "../../context/language"

/** How the last Enhance request ended, when it did not replace the draft. */
export type EnhanceState = { kind: "failed" | "timeout" | "stopped" | "changed"; id: string; error?: string }

const icons = { failed: "warning", timeout: "clock", stopped: "stop", changed: "stop" } as const

export const EnhanceStatus: Component<{
  state: EnhanceState
  disabled: boolean
  onRetry: () => void
  onDismiss: () => void
}> = (props) => {
  const language = useLanguage()
  const text = () => language.t(`prompt.enhance.status.${props.state.kind}`, { error: props.state.error ?? "" })
  const alert = () => props.state.kind === "failed" || props.state.kind === "timeout"
  return (
    <div class="prompt-enhance-status" data-kind={props.state.kind} role={alert() ? "alert" : "status"}>
      <Icon name={icons[props.state.kind]} size="small" />
      <div class="prompt-enhance-status-text">
        <span>{text()}</span>
        <span class="prompt-enhance-status-id">
          {language.t("prompt.enhance.status.request", { id: props.state.id })}
        </span>
      </div>
      <Button variant="ghost" size="small" disabled={props.disabled} onClick={props.onRetry}>
        {language.t("common.retry")}
      </Button>
      <IconButton
        icon="close"
        variant="ghost"
        size="small"
        onClick={props.onDismiss}
        aria-label={language.t("common.dismiss")}
      />
    </div>
  )
}
