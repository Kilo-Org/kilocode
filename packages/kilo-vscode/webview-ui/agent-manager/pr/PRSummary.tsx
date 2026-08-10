/** @jsxImportSource solid-js */
import { Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { PRStatus } from "../../src/types/messages"

interface PRSummaryProps {
  pr: PRStatus
}

function summaryRows(pr: PRStatus): Array<{ icon: string; label: string; status: string }> {
  const rows = []

  if (pr.checks.total > 0) {
    const { passed, total, status } = pr.checks
    rows.push({
      icon: status === "success" ? "circle-check" : status === "failure" ? "circle-x-outline" : "play",
      label: status === "success" ? "All checks passing" : `${passed}/${total} checks passed`,
      status,
    })
  }

  if (pr.review) {
    const status = pr.review === "approved" ? "success" : pr.review === "changes_requested" ? "failure" : "pending"
    rows.push({
      icon: status === "success" ? "circle-check" : status === "failure" ? "circle-x-outline" : "play",
      label: status === "success" ? "Approved" : status === "failure" ? "Changes requested" : "Review pending",
      status,
    })
  }

  if (pr.comments && pr.comments.unresolved > 0) {
    rows.push({
      icon: "comment",
      label: `${pr.comments.unresolved} unresolved comment${pr.comments.unresolved > 1 ? "s" : ""}`,
      status: "warning",
    })
  }

  return rows
}

export function PRSummary(props: PRSummaryProps) {
  const rows = () => summaryRows(props.pr)
  return (
    <Show when={rows().length > 0}>
      <div class="am-pr-summary">
        <div class="am-pr-summary-header am-pr-row">
          <span class="am-pr-summary-title">PR Summary</span>
          <span class="am-pr-panel-section-count am-pr-panel-diff am-pr-row">
            <Show when={props.pr.files > 0}>
              <span class="am-stat-files">{props.pr.files}f</span>
            </Show>
            <Show when={props.pr.additions > 0}>
              <span class="am-stat-additions">+{props.pr.additions}</span>
            </Show>
            <Show when={props.pr.deletions > 0}>
              <span class="am-stat-deletions">−{props.pr.deletions}</span>
            </Show>
          </span>
        </div>
        <div class="am-pr-summary-rows am-pr-col">
          {rows().map((row) => (
            <div class="am-pr-summary-row am-pr-row" data-status={row.status}>
              <Icon name={row.icon} size="small" class="am-pr-summary-icon" />
              <span class="am-pr-summary-label">{row.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Show>
  )
}
