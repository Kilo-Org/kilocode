/** @jsxImportSource solid-js */
import { Show } from "solid-js"

export function PRFileChanges(props: { files: number; additions: number; deletions: number }) {
  return (
    <>
      <div class="am-pr-panel-divider" />
      <div class="am-pr-panel-section">
        <div class="am-pr-panel-section-heading am-pr-row">
          File Changes
          <span class="am-pr-panel-section-count am-pr-panel-diff am-pr-row">
            <Show when={props.files > 0}>
              <span class="am-stat-files">{props.files}f</span>
            </Show>
            <Show when={props.additions > 0}>
              <span class="am-stat-additions">+{props.additions}</span>
            </Show>
            <Show when={props.deletions > 0}>
              <span class="am-stat-deletions">−{props.deletions}</span>
            </Show>
          </span>
        </div>
      </div>
    </>
  )
}
