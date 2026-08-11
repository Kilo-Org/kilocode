/** @jsxImportSource solid-js */
import { Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { PRStatus } from "../../src/types/messages"

interface PRSummaryProps {
  pr: PRStatus
  onJumpToComments?: () => void
}

function summaryRows(pr: PRStatus): Array<{ icon: string; label: string; status: string; isComments?: boolean }> {
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

  if (pr.comments && pr.comments.total > 0) {
    const unresolved = pr.comments.unresolved
    const total = pr.comments.total
    const label =
      unresolved > 0
        ? `${unresolved} unresolved comment${unresolved > 1 ? "s" : ""}`
        : `${total} comment${total > 1 ? "s" : ""}`
    rows.push({
      icon: "comment",
      label,
      status: unresolved > 0 ? "warning" : "success",
      isComments: true,
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
          {rows().map((row) => {
            const isClickable = !!(row.isComments && props.onJumpToComments)
            const rowProps = {
              class: "am-pr-summary-row am-pr-row",
              classList: { "am-pr-summary-row-link": isClickable },
              "data-status": row.status,
            }
            const content = (
              <>
                <Icon name={row.icon} size="small" class="am-pr-summary-icon" />
                <span class="am-pr-summary-label">{row.label}</span>
                {row.isComments && props.onJumpToComments && <span class="am-pr-summary-jump">Jump to comments ↓</span>}
              </>
            )
            return isClickable ? (
              <button {...rowProps} onClick={props.onJumpToComments}>
                {content}
              </button>
            ) : (
              <div {...rowProps}>{content}</div>
            )
          })}
        </div>
      </div>
    </Show>
  )
}
