/** @jsxImportSource solid-js */
import { For, Show, createSignal } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { PRStatus } from "../../src/types/messages"
import type { PRCheck, CheckStatus } from "./pr-types"
import { SectionHeading } from "./SectionHeading"

const CHECK: Record<CheckStatus, { icon: string; label: string }> = {
  success: { icon: "circle-check", label: "Passed" },
  failure: { icon: "circle-x-outline", label: "Failed" },
  cancelled: { icon: "circle-x-outline", label: "Cancelled" },
  skipped: { icon: "circle-x-outline", label: "Skipped" },
  pending: { icon: "play", label: "Running" },
}

export function PRChecks(props: { checks: PRStatus["checks"] }) {
  const [open, setOpen] = createSignal(true)
  return (
    <>
      <div class="am-pr-panel-divider" />
      <div class="am-pr-panel-section">
        <SectionHeading
          title="Checks"
          open={open()}
          onToggle={() => setOpen((v) => !v)}
          count={`${props.checks.passed}/${props.checks.total} passed`}
          countClass={`am-pr-checks-count-${props.checks.status}`}
        />
        <Show when={open()}>
          <div class="am-pr-panel-checks am-pr-col">
            <For each={props.checks.checks}>
              {(check: PRCheck) => (
                <div class="am-pr-panel-check-item am-pr-row" data-status={check.status}>
                  <Icon name={CHECK[check.status].icon} size="small" class="am-pr-check-icon" />
                  <span class="am-pr-check-name">{check.name}</span>
                  <span class="am-pr-check-status">{CHECK[check.status].label}</span>
                  <Show when={check.duration}>
                    <span class="am-pr-check-duration">{check.duration}</span>
                  </Show>
                  <Show when={check.url}>
                    <a class="am-pr-check-link" href={check.url} onClick={(e) => e.preventDefault()}>
                      <Icon name="link" size="small" />
                    </a>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </>
  )
}
