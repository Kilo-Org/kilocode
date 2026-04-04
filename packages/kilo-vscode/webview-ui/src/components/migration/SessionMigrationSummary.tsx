import type { Component } from "solid-js"
import SessionMigrationCard from "./SessionMigrationCard"
import type { SessionSummaryState } from "./session-migration-summary-state"
import { showToast } from "@kilocode/kilo-ui/toast"

interface SessionMigrationSummaryProps {
  summary: SessionSummaryState
}

const SessionMigrationSummary: Component<SessionMigrationSummaryProps> = (props) => {
  const copy = async () => {
    if (!props.summary.lastErrorRaw) return
    await navigator.clipboard.writeText(props.summary.lastErrorRaw)
    showToast({ variant: "success", title: "Copied error" })
  }

  return (
    <SessionMigrationCard>
      <div class="migration-session-summary">
        <div class="migration-session-summary__title">Summary:</div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">- Imported:</div>
          <div class="migration-session-summary__value">- {props.summary.imported.length} sessions</div>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">- Skipped: (Session was already imported)</div>
          <div class="migration-session-summary__value">- {props.summary.skipped.length} sessions</div>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">- Errored:</div>
          <div class="migration-session-summary__value">- {props.summary.errored.length} sessions</div>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__row">
            <div class="migration-session-summary__label">- LastError:</div>
            {props.summary.lastErrorRaw && (
              <button type="button" class="migration-wizard__copy-btn" onClick={() => void copy()}>
                Copy
              </button>
            )}
          </div>
          <div class="migration-session-summary__value">- {props.summary.lastError || "None"}</div>
        </div>
      </div>
    </SessionMigrationCard>
  )
}

export default SessionMigrationSummary
