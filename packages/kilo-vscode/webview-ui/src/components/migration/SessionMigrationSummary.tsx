import type { Component } from "solid-js"
import { For } from "solid-js"
import SessionMigrationCard from "./SessionMigrationCard"
import type { SessionSummaryState } from "./session-migration-summary-state"
import { showToast } from "@kilocode/kilo-ui/toast"
import { errored, line, report } from "./session-migration-summary-format"

interface SessionMigrationSummaryProps {
  summary: SessionSummaryState
}

const SessionMigrationSummary: Component<SessionMigrationSummaryProps> = (props) => {
  const label = (name: string, count: number, desc?: string) => {
    const suffix = count > 0 ? ` (${count})` : ""
    const extra = desc ? ` - ${desc}` : ""
    return `${name}${extra}${suffix}:`
  }

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
          <div class="migration-session-summary__label">{label("Successful", props.summary.imported.length)}</div>
          <div class="migration-session-summary__list migration-session-summary__list--success">
            <For each={props.summary.imported.length > 0 ? props.summary.imported : [undefined]}>
              {(item) => <div class="migration-session-summary__item">{item ? line(item) : "None"}</div>}
            </For>
          </div>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">{label("Skipped", props.summary.skipped.length, "Already migrated")}</div>
          <div class="migration-session-summary__list migration-session-summary__list--skipped">
            <For each={props.summary.skipped.length > 0 ? props.summary.skipped : [undefined]}>
              {(item) => <div class="migration-session-summary__item">{item ? line(item) : "None"}</div>}
            </For>
          </div>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">{label("Errored", props.summary.errored.length)}</div>
          <div class="migration-session-summary__list migration-session-summary__list--errored">
            <For each={errored(props.summary)}>
              {(item) =>
                item.kind === "detail" ? (
                  <div class="migration-session-summary__detail">{item.text}</div>
                ) : (
                  <div class="migration-session-summary__item">{item.text}</div>
                )
              }
            </For>
          </div>
        </div>
      </div>
    </SessionMigrationCard>
  )
}

export default SessionMigrationSummary
