import { Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useLanguage } from "../src/context/language"
import type { SetupState } from "./project/progress"

export function SetupOverlay(props: { state: SetupState; title?: string; cloud?: boolean }) {
  const { t } = useLanguage()
  return (
    <div class="am-setup-overlay">
      <div class="am-setup-card">
        <Icon name={props.cloud ? "cloud" : "branch"} size="large" />
        <div class="am-setup-title">
          {props.title ?? t(props.state.error ? "agentManager.setup.failed" : "agentManager.setup.settingUp")}
        </div>
        <Show when={props.state.branch}>
          <div class="am-setup-branch">{props.state.branch}</div>
        </Show>
        <div class="am-setup-status">
          <Show when={!props.state.error} fallback={<Icon name="circle-x" size="small" />}>
            <Spinner class="am-setup-spinner" />
          </Show>
          <span>
            {props.state.errorCode ? t(`agentManager.setup.error.${props.state.errorCode}`) : props.state.message}
          </span>
        </div>
      </div>
    </div>
  )
}
