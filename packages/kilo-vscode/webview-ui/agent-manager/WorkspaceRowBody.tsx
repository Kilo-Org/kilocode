import { Icon } from "@kilocode/kilo-ui/icon"
import type { JSX } from "solid-js"
import { ActivityIcon } from "../src/components/shared/ActivityIcon"
import { useLanguage } from "../src/context/language"
import { label, type Activity } from "./v2/activity"

export function WorkspaceRowBody(props: {
  state: Activity
  cloud?: boolean
  primary: JSX.Element
  children: JSX.Element
}) {
  const { t } = useLanguage()
  return (
    <>
      <div
        class="am-wt-icon"
        data-origin={props.cloud ? "cloud" : undefined}
        data-activity={props.cloud ? undefined : props.state}
        aria-label={t(props.cloud ? "session.tab.cloud" : label(props.state))}
      >
        {props.cloud ? (
          <Icon name="cloud" size="small" />
        ) : (
          <ActivityIcon state={props.state} idle={<Icon name="branch" size="small" />} />
        )}
      </div>
      {props.cloud && props.state !== "idle" && (
        <span class="am-local-status" data-activity={props.state} aria-label={t(label(props.state))}>
          <ActivityIcon state={props.state} />
        </span>
      )}
      <div class="am-wt-content">
        <div class="am-wt-row1">{props.primary}</div>
        <div class="am-wt-row2">{props.children}</div>
      </div>
    </>
  )
}
