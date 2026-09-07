/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { PRStatus } from "../../src/types/messages"
import type { PRCheck, CheckStatus } from "./pr-types"
import { SectionHeading } from "./SectionHeading"
import { useVSCode } from "../../src/context/vscode"
import { useLanguage } from "../../src/context/language"
import { sendReviewComments } from "../../diff-viewer/review-annotations"
import { checkFeedback } from "./pr-check-feedback"

const CHECK: Record<CheckStatus, { icon: string; label: string }> = {
  success: { icon: "circle-check", label: "Passed" },
  failure: { icon: "circle-x-outline", label: "Failed" },
  cancelled: { icon: "circle-x-outline", label: "Cancelled" },
  skipped: { icon: "circle-x-outline", label: "Skipped" },
  pending: { icon: "play", label: "Running" },
}

export function PRChecks(props: { pr: PRStatus; activeTerminalId?: string }) {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const [open, setOpen] = createSignal(true)
  const feedback = createMemo(() => checkFeedback(props.pr, t("agentManager.pr.checks.feedback")))
  const send = () => {
    const item = feedback()
    if (!item) return
    sendReviewComments([item], props.activeTerminalId)
  }
  return (
    <>
      <div class="am-pr-panel-divider" />
      <div class="am-pr-panel-section">
        <SectionHeading
          title="Checks"
          open={open()}
          onToggle={() => setOpen((v) => !v)}
          count={`${props.pr.checks.passed}/${props.pr.checks.total} passed`}
          countClass={`am-pr-checks-count-${props.pr.checks.status}`}
        />
        <Show when={open()}>
          <Show when={feedback()}>
            <Button variant="primary" size="small" class="am-pr-checks-fix" onClick={send}>
              {t(props.activeTerminalId ? "agentManager.pr.checks.terminal" : "agentManager.pr.checks.fix")}
            </Button>
          </Show>
          <div class="am-pr-panel-checks am-pr-col">
            <For each={props.pr.checks.checks}>
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
