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

  const reviewers = pr.comments?.reviewers
  if (reviewers && reviewers.length > 0) {
    const approved = reviewers.filter((r) => r.state === "approved").length
    const changes = reviewers.filter((r) => r.state === "changes_requested").length
    const status = approved === reviewers.length ? "success" : changes > 0 ? "failure" : "pending"
    rows.push({
      icon: status === "success" ? "circle-check" : status === "failure" ? "circle-x-outline" : "play",
      label: approved === reviewers.length ? "All reviewers approved" : `${approved}/${reviewers.length} approvals`,
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
