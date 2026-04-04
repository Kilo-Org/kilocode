import type { Component } from "solid-js"
import { For } from "solid-js"
import SessionMigrationCard from "./SessionMigrationCard"
import type { SessionSummaryState } from "./session-migration-summary-state"
import { showToast } from "@kilocode/kilo-ui/toast"
import { errors, line, report } from "./session-migration-summary-format"

interface SessionMigrationSummaryProps {
  summary: SessionSummaryState
}

const SessionMigrationSummary: Component<SessionMigrationSummaryProps> = (props) => {
  const handleCopy = async () => {
    const text = report(props.summary)
    if (!text) return
    await navigator.clipboard.writeText(text)
    showToast({ variant: "success", title: "Copied report" })
  }

  return (
    <SessionMigrationCard>
      <div class="migration-session-summary">
        <div class="migration-session-summary__row">
          <div class="migration-session-summary__title">Summary:</div>
          <button type="button" class="migration-wizard__copy-btn" onClick={() => void handleCopy()}>
            Copy Report
          </button>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">- Successful</div>
          <div class="migration-session-summary__list migration-session-summary__list--success">
            <For each={props.summary.imported.length > 0 ? props.summary.imported : [undefined]}>
              {(item) => <div class="migration-session-summary__item">{item ? line(item) : "None"}</div>}
            </For>
          </div>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">- Skipped</div>
          <div class="migration-session-summary__list migration-session-summary__list--skipped">
            <For each={props.summary.skipped.length > 0 ? props.summary.skipped : [undefined]}>
              {(item) => <div class="migration-session-summary__item">{item ? line(item) : "None"}</div>}
            </For>
          </div>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">- Errored</div>
          <div class="migration-session-summary__list migration-session-summary__list--errored">
            <For each={props.summary.errored.length > 0 ? props.summary.errored : [undefined]}>
              {(item) => <div class="migration-session-summary__item">{item ? line(item) : "None"}</div>}
            </For>
          </div>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">- Errors</div>
          <div class="migration-session-summary__list migration-session-summary__list--errored">
            <For each={errors(props.summary).length > 0 ? errors(props.summary) : ["None"]}>
              {(item) => <div class="migration-session-summary__item">{item === "None" ? item : `- ${item}`}</div>}
            </For>
          </div>
        </div>
      </div>
    </SessionMigrationCard>
  )
}

export default SessionMigrationSummary
