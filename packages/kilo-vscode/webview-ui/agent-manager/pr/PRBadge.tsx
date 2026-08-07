/** @jsxImportSource solid-js */
import { Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { PRStatus } from "../../src/types/messages"
import { prBadgeIndicator, prChecksRunning } from "../WorktreeItem"

const INDICATOR_ICON: Record<string, string> = {
  failure: "circle-x-outline",
  changes: "warning",
  approved: "circle-check",
}

export function PRBadge(props: { pr: PRStatus }) {
  const indicator = () => prBadgeIndicator(props.pr)
  return (
    <span
      class="am-pr-panel-badge am-pr-row"
      classList={{
        "am-pr-accent-draft": props.pr.state === "draft",
        "am-pr-accent-merged": props.pr.state === "merged",
        "am-pr-accent-closed": props.pr.state === "closed",
        "am-pr-accent-pending": props.pr.state === "open" && props.pr.checks.status === "pending",
        "am-pr-accent-open": props.pr.state === "open" && props.pr.checks.status !== "pending",
        "am-pr-badge-pending": prChecksRunning(props.pr),
      }}
    >
      <Icon name="pull-request" size="small" />
      <Show when={indicator() !== "none"}>
        <Icon name={INDICATOR_ICON[indicator()]} size="small" class="am-pr-badge-status" data-status={indicator()} />
      </Show>
    </span>
  )
}
