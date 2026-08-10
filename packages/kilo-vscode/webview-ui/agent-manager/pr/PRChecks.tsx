/** @jsxImportSource solid-js */
import { For, Show, createSignal } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { PRStatus } from "../../src/types/messages"
import type { PRCheck, CheckStatus } from "./pr-types"
import { SectionHeading } from "./SectionHeading"
import { useVSCode } from "../../src/context/vscode"

const CHECK: Record<CheckStatus, { icon: string; label: string }> = {
  success: { icon: "circle-check", label: "Passed" },
  failure: { icon: "circle-x-outline", label: "Failed" },
  cancelled: { icon: "circle-x-outline", label: "Cancelled" },
  skipped: { icon: "circle-x-outline", label: "Skipped" },
  pending: { icon: "play", label: "Running" },
}

export function PRChecks(props: { checks: PRStatus["checks"] }) {
  const vscode = useVSCode()
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
                    <Tooltip value="Open in browser" placement="bottom">
                      <button
                        class="am-pr-check-link"
                        aria-label="Open check in browser"
                        onClick={() => vscode.postMessage({ type: "openExternal", url: check.url! })}
                      >
                        <Icon name="link" size="small" />
                      </button>
                    </Tooltip>
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
