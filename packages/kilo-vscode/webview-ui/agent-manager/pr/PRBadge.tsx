/** @jsxImportSource solid-js */
import { Icon } from "@kilocode/kilo-ui/icon"
import type { PRStatus } from "../../src/types/messages"
import { prBadgeAccent, prBadgeIndicator, prChecksRunning } from "../WorktreeItem"

const INDICATOR_ICON: Record<string, string> = {
  failure: "circle-x",
  changes: "warning",
  approved: "circle-check",
  none: "branch",
}

export function PRBadge(props: { pr: PRStatus }) {
  const indicator = () => prBadgeIndicator(props.pr)
  return (
    <span
      class="am-pr-panel-badge am-pr-row"
      data-accent={prBadgeAccent(props.pr)}
      classList={{ "am-pr-badge-pending": prChecksRunning(props.pr) }}
    >
      <Icon
        name={INDICATOR_ICON[indicator()]}
        size="small"
        classList={{ "am-pr-badge-status": indicator() !== "none" }}
        data-status={indicator() !== "none" ? indicator() : undefined}
      />
      <span class="am-pr-badge-number">#{props.pr.number}</span>
    </span>
  )
}
