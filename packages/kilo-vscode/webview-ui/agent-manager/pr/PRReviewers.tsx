/** @jsxImportSource solid-js */
import { For, Show, createSignal } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { PRReviewer, ReviewerState } from "./pr-types"
import { SectionHeading } from "./SectionHeading"

const REVIEWER_ICON: Record<ReviewerState, string> = {
  approved: "circle-check",
  changes_requested: "refresh",
  commented: "edit",
  pending: "dash",
}

const REVIEWER_LABEL: Record<ReviewerState, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  commented: "Commented",
  pending: "Awaiting",
}

export function PRReviewers(props: { reviewers: PRReviewer[] }) {
  const [open, setOpen] = createSignal(true)
  return (
    <>
      <div class="am-pr-panel-divider" />
      <div class="am-pr-panel-section">
        <SectionHeading title="Reviewers" open={open()} onToggle={() => setOpen((v) => !v)} />
        <Show when={open()}>
          <div class="am-pr-panel-reviewers am-pr-col">
            <For each={props.reviewers}>
              {(reviewer) => (
                <div class="am-pr-panel-reviewer am-pr-row" data-state={reviewer.state}>
                  <Icon name={REVIEWER_ICON[reviewer.state]} size="small" class="am-pr-reviewer-icon" />
                  <span class="am-pr-reviewer-login">{reviewer.login}</span>
                  <span class="am-pr-reviewer-state">{REVIEWER_LABEL[reviewer.state]}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </>
  )
}
