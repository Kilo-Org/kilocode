import type { Component } from "solid-js"
import SessionMigrationCard from "./SessionMigrationCard"
import type { SessionSummaryState } from "./session-migration-summary-state"

interface SessionMigrationSummaryProps {
  summary: SessionSummaryState
}

const SessionMigrationSummary: Component<SessionMigrationSummaryProps> = (props) => {
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
          <div class="migration-session-summary__label">- LastError:</div>
          <div class="migration-session-summary__value">- {props.summary.lastError || "None"}</div>
        </div>
      </div>
    </SessionMigrationCard>
  )
}

export default SessionMigrationSummary
