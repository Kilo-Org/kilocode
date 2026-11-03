/** @jsxImportSource solid-js */
import { For, Show, createSignal } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { PRReviewer, ReviewerState } from "./pr-types"
import { PRAvatar } from "./PRAvatar"
import { SectionHeading } from "./SectionHeading"

const REVIEWER_ICON: Record<ReviewerState, string> = {
  approved: "circle-check",
  changes_requested: "circle-x-outline",
  commented: "comment",
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
                  <PRAvatar author={reviewer.login} avatar={reviewer.avatar} />
                  <span class="am-pr-reviewer-login">{reviewer.login}</span>
                  <Tooltip value={REVIEWER_LABEL[reviewer.state]} placement="top" class="am-pr-reviewer-state">
                    <span role="img" aria-label={REVIEWER_LABEL[reviewer.state]}>
                      <Icon name={REVIEWER_ICON[reviewer.state]} size="small" class="am-pr-reviewer-icon" />
                    </span>
                  </Tooltip>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </>
  )
}
