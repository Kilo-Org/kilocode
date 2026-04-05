import type { Component } from "solid-js"
import { For, Show, createMemo, createSignal } from "solid-js"
import SessionMigrationCard from "./SessionMigrationCard"
import type { SessionSummaryState } from "./session-migration-summary-state"
import { showToast } from "@kilocode/kilo-ui/toast"
import { errored, line, report } from "./session-migration-summary-format"

interface SessionMigrationSummaryProps {
  summary: SessionSummaryState
  onForce: (ids: string[]) => void
}

const SessionMigrationSummary: Component<SessionMigrationSummaryProps> = (props) => {
  const [all, setAll] = createSignal(false)
  const [selected, setSelected] = createSignal<string[]>([])

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

  const skipped = createMemo(() => props.summary.skipped)
  const ids = createMemo(() => skipped().map((item) => item.id))
  const picked = createMemo(() => (all() ? ids() : selected()))

  const toggle = (id: string, next: boolean) => {
    setAll(false)
    setSelected((prev) => (next ? [...prev.filter((item) => item !== id), id] : prev.filter((item) => item !== id)))
  }

  const handleAll = (next: boolean) => {
    setAll(next)
    if (next) {
      setSelected([])
      return
    }
  }

  const handleForce = () => {
    const list = picked()
    if (list.length === 0) return
    props.onForce(list)
    showToast({ variant: "success", title: "Force re-import started" })
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
              {(item) =>
                item ? (
                  <label class="migration-session-summary__pick">
                    <span class="migration-session-summary__item">{line(item)}</span>
                    <input
                      type="checkbox"
                      checked={all() || selected().includes(item.id)}
                      onChange={(event) => toggle(item.id, event.currentTarget.checked)}
                    />
                    <span class="migration-session-summary__pick-mark">
                      <svg viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="2.5 6 5 8.5 9.5 3.5" />
                      </svg>
                    </span>
                  </label>
                ) : (
                  <div class="migration-session-summary__item">None</div>
                )
              }
            </For>
          </div>
          <Show when={props.summary.skipped.length > 0}>
            <div class="migration-session-summary__actions">
              <label class="migration-session-summary__all">
                <span>Re-import all</span>
                <input type="checkbox" checked={all()} onChange={(event) => handleAll(event.currentTarget.checked)} />
                <span class="migration-session-summary__pick-mark migration-session-summary__pick-mark--all">
                  <svg viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="2.5 6 5 8.5 9.5 3.5" />
                  </svg>
                </span>
              </label>
              <button
                type="button"
                class="migration-wizard__copy-btn"
                disabled={picked().length === 0}
                onClick={() => handleForce()}
              >
                Force Re-import
              </button>
            </div>
          </Show>
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
