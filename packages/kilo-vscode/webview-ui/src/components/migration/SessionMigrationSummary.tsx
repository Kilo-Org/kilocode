import type { Component } from "solid-js"
import { For } from "solid-js"
import SessionMigrationCard from "./SessionMigrationCard"
import type { SessionSummaryState } from "./session-migration-summary-state"
import { showToast } from "@kilocode/kilo-ui/toast"
import { copy as formatCopy, errors, line } from "./session-migration-summary-format"

interface SessionMigrationSummaryProps {
  summary: SessionSummaryState
}

const SessionMigrationSummary: Component<SessionMigrationSummaryProps> = (props) => {
  const handleCopy = async () => {
    const text = formatCopy(props.summary)
    if (!text) return
    await navigator.clipboard.writeText(text)
    showToast({ variant: "success", title: "Copied errors" })
  }

  return (
    <SessionMigrationCard>
      <div class="migration-session-summary">
        <div class="migration-session-summary__title">Summary:</div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">- Successful</div>
          <div class="migration-session-summary__list">
            <For each={props.summary.imported}>{(item) => <div class="migration-session-summary__item">{line(item)}</div>}</For>
          </div>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">- Skipped</div>
          <div class="migration-session-summary__list">
            <For each={props.summary.skipped}>{(item) => <div class="migration-session-summary__item">{line(item)}</div>}</For>
          </div>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">- Errored</div>
          <div class="migration-session-summary__list">
            <For each={props.summary.errored}>{(item) => <div class="migration-session-summary__item">{line(item)}</div>}</For>
          </div>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__row">
            <div class="migration-session-summary__label">- Errors</div>
            {props.summary.errored.length > 0 && (
              <button type="button" class="migration-wizard__copy-btn" onClick={() => void handleCopy()}>
                Copy
              </button>
            )}
          </div>
          <div class="migration-session-summary__list">
            <For each={errors(props.summary)}>{(item) => <div class="migration-session-summary__item">- {item}</div>}</For>
          </div>
        </div>
      </div>
    </SessionMigrationCard>
  )
}

export default SessionMigrationSummary
