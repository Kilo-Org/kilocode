import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Match, Switch, type Component, type JSX } from "solid-js"
import { running, type Activity } from "../../utils/session-activity"

export const ActivityIcon: Component<{
  state: Activity
  idle?: JSX.Element
  spinner?: string
}> = (props) => (
  <Switch fallback={props.idle ?? <Icon name="speech-bubble" size="small" />}>
    <Match when={running(props.state)}>
      <Spinner class={props.spinner ?? "am-worktree-spinner"} />
    </Match>
    <Match when={props.state === "waiting" || props.state === "error"}>
      <Icon name="warning" size="small" />
    </Match>
    <Match when={props.state === "done"}>
      <Icon name="circle-check" size="small" />
    </Match>
  </Switch>
)
